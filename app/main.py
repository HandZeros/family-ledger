"""家庭账本 —— 后端 API。"""
from __future__ import annotations

import csv
import io
import json
import re
import sqlite3
import time
from contextlib import asynccontextmanager
from datetime import date as dt_date, datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .auth import (
    DEFAULT_MEMBER_PERMS,
    PERM_KEYS,
    PERMISSIONS,
    current_user,
    get_db,
    has_perm,
    hash_password,
    load_user,
    make_token,
    require,
    require_admin,
    user_public,
    verify_password,
)
from .db import get_setting, init_db, now_iso, set_setting

STATIC_DIR = Path(__file__).resolve().parent / "static"
USERNAME_RE = re.compile(r"^[\w\u4e00-\u9fa5.\-]{2,20}$")
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
PALETTE = ["#2E6B5A", "#4A7DBB", "#D2694E", "#8A6FBF", "#4E9CA6", "#D9A23B", "#CF5D6B", "#5B7FA6"]

@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="家庭账本",
    version="1.2.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

# 外网暴露时的基础安全响应头。
# connect-src 放开 http/https 是因为登录页允许填写任意服务器地址（含局域网 IP）。
CSP = (
    "default-src 'self'; base-uri 'self'; form-action 'self'; "
    "img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; connect-src http: https:; frame-ancestors 'self'"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    headers = response.headers
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()")
    headers.setdefault("Content-Security-Policy", CSP)
    proto = request.headers.get("x-forwarded-proto", request.url.scheme).lower()
    if proto == "https":
        headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


# ---------------------------------------------------------------- 工具函数
def to_cents(amount: float) -> int:
    return int(round(float(amount) * 100))


def yuan(cents: int) -> float:
    return round((cents or 0) / 100, 2)


def valid_month(month: str) -> str:
    if not MONTH_RE.match(month):
        raise HTTPException(status_code=400, detail="月份格式应为 YYYY-MM")
    return month


def month_bounds(month: str) -> tuple[str, str]:
    valid_month(month)
    year, mon = int(month[:4]), int(month[5:7])
    start = dt_date(year, mon, 1)
    end = dt_date(year + (mon == 12), 1 if mon == 12 else mon + 1, 1) - timedelta(days=1)
    return start.isoformat(), end.isoformat()


def prev_month(month: str) -> str:
    year, mon = int(month[:4]), int(month[5:7])
    return f"{year - 1}-12" if mon == 1 else f"{year}-{mon - 1:02d}"


def valid_date(text: str) -> str:
    try:
        return datetime.strptime(text, "%Y-%m-%d").strftime("%Y-%m-%d")
    except Exception:
        raise HTTPException(status_code=400, detail="日期格式应为 YYYY-MM-DD")


def clean_note(note: str) -> str:
    return (note or "").strip()[:120]


def scope_clause(user: dict) -> tuple[str, tuple]:
    """非「查看全家账本」权限的成员只能看到自己的流水。"""
    if has_perm(user, "view_all"):
        return "", ()
    return " AND t.user_id = ?", (user["id"],)


def get_tx_or_404(conn: sqlite3.Connection, tx_id: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="记录不存在")
    return row


def assert_can_modify(user: dict, row: sqlite3.Row) -> None:
    if user["role"] == "admin":
        return
    if row["user_id"] == user["id"] and "edit_own" in user["perms"]:
        return
    raise HTTPException(status_code=403, detail="只能修改自己记录，或联系管理员")


# ---------------------------------------------------------------- 数据模型
class SetupIn(BaseModel):
    username: str
    password: str
    display_name: str = ""
    site_name: str = "家庭账本"


class LoginIn(BaseModel):
    username: str
    password: str


class UserIn(BaseModel):
    username: str
    password: str
    display_name: str = ""
    perms: list[str] = []
    role: str = "member"


class UserPatch(BaseModel):
    password: Optional[str] = None
    display_name: Optional[str] = None
    perms: Optional[list[str]] = None
    is_active: Optional[bool] = None
    role: Optional[str] = None


class TxIn(BaseModel):
    kind: str
    amount: float
    category_id: Optional[int] = None
    account_id: Optional[int] = None
    to_account_id: Optional[int] = None
    date: str
    note: str = ""


class CategoryIn(BaseModel):
    name: str
    kind: str = "expense"
    icon: str = "📦"
    color: str = "#8A8578"
    parent_id: Optional[int] = None


class CategoryPatch(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    archived: Optional[bool] = None


class AccountIn(BaseModel):
    name: str
    icon: str = "💰"
    type: str = "cash"
    initial_balance: float = 0


class AccountPatch(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    type: Optional[str] = None
    initial_balance: Optional[float] = None
    archived: Optional[bool] = None


class BudgetIn(BaseModel):
    month: str
    amount: float


class PasswordIn(BaseModel):
    old_password: str
    new_password: str


# ---------------------------------------------------------------- 公共
@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/status")
def status(conn: sqlite3.Connection = Depends(get_db)):
    has_user = conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"] > 0
    return {
        "setup_done": has_user,
        "site_name": get_setting(conn, "site_name", "家庭账本"),
        "version": app.version,
        "permission_catalog": [{"key": k, "label": v} for k, v in PERMISSIONS],
    }


@app.post("/api/setup")
def setup(payload: SetupIn, conn: sqlite3.Connection = Depends(get_db)):
    """首次运行：创建管理员账号。"""
    if conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"] > 0:
        raise HTTPException(status_code=400, detail="系统已完成初始化")
    username = payload.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="用户名需 2-20 位，可用中英文、数字、下划线")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")

    now = now_iso()
    cur = conn.execute(
        "INSERT INTO users(username, password_hash, display_name, role, perms, color, created_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (
            username,
            hash_password(payload.password),
            (payload.display_name or username).strip()[:20],
            "admin",
            json.dumps(PERM_KEYS),
            PALETTE[0],
            now,
        ),
    )
    if payload.site_name.strip():
        set_setting(conn, "site_name", payload.site_name.strip()[:20])
    conn.commit()
    user = load_user(conn, cur.lastrowid)
    secret = get_setting(conn, "jwt_secret")
    return {
        "token": make_token(user["id"], 0, secret),
        "user": user,
        "site_name": get_setting(conn, "site_name", "家庭账本"),
    }


# ---------------------------------------------------------------- 认证
_login_fails: dict[str, list[float]] = {}


@app.post("/api/auth/login")
def login(payload: LoginIn, request: Request, conn: sqlite3.Connection = Depends(get_db)):
    key = f"{request.client.host if request.client else '-'}:{payload.username.lower()}"
    now_ts = time.time()
    fails = [t for t in _login_fails.get(key, []) if now_ts - t < 300]
    if len(fails) >= 8:
        raise HTTPException(status_code=429, detail="尝试次数过多，请 5 分钟后再试")

    row = conn.execute("SELECT * FROM users WHERE username = ?", (payload.username.strip(),)).fetchone()
    if not row or not verify_password(payload.password, row["password_hash"]):
        fails.append(now_ts)
        _login_fails[key] = fails
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not row["is_active"]:
        raise HTTPException(status_code=403, detail="该账号已被停用，请联系管理员")

    _login_fails.pop(key, None)
    user = user_public(row)
    secret = get_setting(conn, "jwt_secret")
    return {
        "token": make_token(user["id"], row["token_version"], secret),
        "user": user,
        "site_name": get_setting(conn, "site_name", "家庭账本"),
    }


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return {"user": user, "site_name": get_setting(conn, "site_name", "家庭账本")}


@app.post("/api/auth/password")
def change_password(
    payload: PasswordIn,
    user: dict = Depends(current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    if not verify_password(payload.old_password, row["password_hash"]):
        raise HTTPException(status_code=400, detail="原密码不正确")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")
    conn.execute(
        "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
        (hash_password(payload.new_password), user["id"]),
    )
    conn.commit()
    new_version = row["token_version"] + 1
    return {"token": make_token(user["id"], new_version, get_setting(conn, "jwt_secret"))}


# ---------------------------------------------------------------- 成员（管理员）
@app.get("/api/members")
def members(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute(
        "SELECT id, username, display_name, role, color, is_active FROM users ORDER BY id"
    ).fetchall()
    return [
        {
            "id": r["id"],
            "username": r["username"],
            "display_name": r["display_name"] or r["username"],
            "role": r["role"],
            "color": r["color"],
            "is_active": bool(r["is_active"]),
        }
        for r in rows
    ]


@app.get("/api/users")
def list_users(admin: dict = Depends(require_admin), conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute("SELECT * FROM users ORDER BY (role='admin') DESC, id").fetchall()
    result = []
    for r in rows:
        item = user_public(r)
        stat = conn.execute(
            "SELECT COUNT(*) c, COALESCE(SUM(amount_cents),0) s FROM transactions WHERE user_id = ?",
            (r["id"],),
        ).fetchone()
        item["tx_count"] = stat["c"]
        item["tx_total"] = yuan(stat["s"])
        result.append(item)
    return result


@app.post("/api/users")
def create_user(payload: UserIn, admin: dict = Depends(require_admin), conn: sqlite3.Connection = Depends(get_db)):
    username = payload.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="用户名需 2-20 位，可用中英文、数字、下划线")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少 6 位")
    if payload.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="角色不合法")
    if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        raise HTTPException(status_code=400, detail="该用户名已存在")

    perms = [p for p in payload.perms if p in PERM_KEYS]
    if payload.role == "admin":
        perms = list(PERM_KEYS)
    count = conn.execute("SELECT COUNT(*) c FROM users").fetchone()["c"]
    cur = conn.execute(
        "INSERT INTO users(username, password_hash, display_name, role, perms, color, created_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (
            username,
            hash_password(payload.password),
            (payload.display_name or username).strip()[:20],
            payload.role,
            json.dumps(perms),
            PALETTE[count % len(PALETTE)],
            now_iso(),
        ),
    )
    conn.commit()
    return user_public(conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())


@app.patch("/api/users/{user_id}")
def update_user(
    user_id: int,
    payload: UserPatch,
    admin: dict = Depends(require_admin),
    conn: sqlite3.Connection = Depends(get_db),
):
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="成员不存在")

    fields: list[str] = []
    values: list = []
    if payload.display_name is not None:
        fields.append("display_name = ?")
        values.append(payload.display_name.strip()[:20] or row["username"])
    if payload.password:
        if len(payload.password) < 6:
            raise HTTPException(status_code=400, detail="密码至少 6 位")
        fields.append("password_hash = ?")
        values.append(hash_password(payload.password))
        fields.append("token_version = token_version + 1")
    if payload.perms is not None:
        if row["role"] == "admin":
            perms = list(PERM_KEYS)
        else:
            perms = [p for p in payload.perms if p in PERM_KEYS]
        fields.append("perms = ?")
        values.append(json.dumps(perms))
    if payload.is_active is not None:
        if user_id == admin["id"] and not payload.is_active:
            raise HTTPException(status_code=400, detail="不能停用当前登录的账号")
        fields.append("is_active = ?")
        values.append(1 if payload.is_active else 0)
    if payload.role is not None:
        if payload.role not in ("admin", "member"):
            raise HTTPException(status_code=400, detail="角色不合法")
        if user_id == admin["id"] and payload.role != "admin":
            raise HTTPException(status_code=400, detail="不能取消自己的管理员身份")
        fields.append("role = ?")
        values.append(payload.role)
        if payload.role == "admin" and payload.perms is None:
            fields.append("perms = ?")
            values.append(json.dumps(PERM_KEYS))

    if not fields:
        return user_public(row)
    values.append(user_id)
    conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()
    return user_public(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, admin: dict = Depends(require_admin), conn: sqlite3.Connection = Depends(get_db)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="不能删除当前登录的账号")
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="成员不存在")
    if row["role"] == "admin":
        admins = conn.execute("SELECT COUNT(*) c FROM users WHERE role='admin' AND is_active=1").fetchone()["c"]
        if admins <= 1:
            raise HTTPException(status_code=400, detail="至少保留一位管理员")
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 账户
def account_rows(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT a.*,
          (SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount_cents
                                    WHEN kind='expense' THEN -amount_cents ELSE 0 END), 0)
             FROM transactions t WHERE t.account_id = a.id) AS flow,
          (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions t
             WHERE t.to_account_id = a.id AND t.kind='transfer') AS inflow,
          (SELECT COALESCE(SUM(amount_cents), 0) FROM transactions t
             WHERE t.account_id = a.id AND t.kind='transfer') AS outflow
        FROM accounts a
        WHERE a.archived = 0
        ORDER BY a.sort, a.id
        """
    ).fetchall()
    result = []
    for r in rows:
        balance = r["initial_cents"] + r["flow"] + r["inflow"] - r["outflow"]
        result.append(
            {
                "id": r["id"],
                "name": r["name"],
                "icon": r["icon"],
                "type": r["type"],
                "initial_balance": yuan(r["initial_cents"]),
                "balance": yuan(balance),
            }
        )
    return result


@app.get("/api/accounts")
def list_accounts(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    return account_rows(conn)


@app.post("/api/accounts")
def create_account(payload: AccountIn, user: dict = Depends(require("manage_accounts")), conn: sqlite3.Connection = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="请填写账户名称")
    sort = conn.execute("SELECT COALESCE(MAX(sort),0)+1 s FROM accounts").fetchone()["s"]
    cur = conn.execute(
        "INSERT INTO accounts(name, icon, type, initial_cents, sort, created_at) VALUES(?,?,?,?,?,?)",
        (name[:20], payload.icon[:4], payload.type, to_cents(payload.initial_balance), sort, now_iso()),
    )
    conn.commit()
    return {"id": cur.lastrowid}


@app.patch("/api/accounts/{account_id}")
def update_account(
    account_id: int,
    payload: AccountPatch,
    user: dict = Depends(require("manage_accounts")),
    conn: sqlite3.Connection = Depends(get_db),
):
    if not conn.execute("SELECT 1 FROM accounts WHERE id = ?", (account_id,)).fetchone():
        raise HTTPException(status_code=404, detail="账户不存在")
    fields, values = [], []
    if payload.name is not None:
        fields.append("name = ?")
        values.append(payload.name.strip()[:20] or "账户")
    if payload.icon is not None:
        fields.append("icon = ?")
        values.append(payload.icon[:4])
    if payload.type is not None:
        fields.append("type = ?")
        values.append(payload.type)
    if payload.initial_balance is not None:
        fields.append("initial_cents = ?")
        values.append(to_cents(payload.initial_balance))
    if payload.archived is not None:
        fields.append("archived = ?")
        values.append(1 if payload.archived else 0)
    if fields:
        values.append(account_id)
        conn.execute(f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    return {"ok": True}


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int, user: dict = Depends(require("manage_accounts")), conn: sqlite3.Connection = Depends(get_db)):
    conn.execute("UPDATE accounts SET archived = 1 WHERE id = ?", (account_id,))
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 分类
@app.get("/api/categories")
def list_categories(
    kind: Optional[str] = None,
    user: dict = Depends(current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    sql = (
        "SELECT c.*, COALESCE(p.sort, c.sort) gsort FROM categories c "
        "LEFT JOIN categories p ON p.id = c.parent_id WHERE c.archived = 0"
    )
    args: list = []
    if kind in ("income", "expense"):
        sql += " AND c.kind = ?"
        args.append(kind)
    # 一级分类按 sort 排，二级紧跟其父；前端据 parent_id 组装树
    sql += " ORDER BY c.kind, gsort, c.parent_id IS NOT NULL, c.sort, c.id"
    rows = conn.execute(sql, args).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "kind": r["kind"],
            "icon": r["icon"],
            "color": r["color"],
            "parent_id": r["parent_id"],
        }
        for r in rows
    ]


@app.post("/api/categories")
def create_category(payload: CategoryIn, user: dict = Depends(require("manage_categories")), conn: sqlite3.Connection = Depends(get_db)):
    kind = payload.kind
    parent_id = payload.parent_id
    if parent_id:
        parent = conn.execute(
            "SELECT * FROM categories WHERE id = ? AND archived = 0", (parent_id,)
        ).fetchone()
        if not parent:
            raise HTTPException(status_code=404, detail="上级分类不存在")
        if parent["parent_id"]:
            raise HTTPException(status_code=400, detail="只支持两级分类")
        kind = parent["kind"]
    if kind not in ("income", "expense"):
        raise HTTPException(status_code=400, detail="类型不合法")
    name = payload.name.strip()[:10]
    if not name:
        raise HTTPException(status_code=400, detail="请填写分类名称")
    dup = conn.execute(
        "SELECT 1 FROM categories WHERE archived = 0 AND kind = ? AND name = ? "
        "AND COALESCE(parent_id, 0) = ?",
        (kind, name, parent_id or 0),
    ).fetchone()
    if dup:
        raise HTTPException(status_code=400, detail="同一级下已有同名分类")
    if parent_id:
        sort = conn.execute(
            "SELECT COALESCE(MAX(sort),0)+1 s FROM categories WHERE parent_id = ?", (parent_id,)
        ).fetchone()["s"]
        color = payload.color if payload.color != "#8A8578" else parent["color"]
    else:
        sort = conn.execute(
            "SELECT COALESCE(MAX(sort),0)+1 s FROM categories WHERE kind = ? AND parent_id IS NULL",
            (kind,),
        ).fetchone()["s"]
        color = payload.color
    cur = conn.execute(
        "INSERT INTO categories(name, kind, icon, color, parent_id, sort) VALUES(?,?,?,?,?,?)",
        (name, kind, payload.icon[:4] or "📦", color, parent_id, sort),
    )
    conn.commit()
    return {"id": cur.lastrowid}


@app.patch("/api/categories/{category_id}")
def update_category(
    category_id: int,
    payload: CategoryPatch,
    user: dict = Depends(require("manage_categories")),
    conn: sqlite3.Connection = Depends(get_db),
):
    if not conn.execute("SELECT 1 FROM categories WHERE id = ?", (category_id,)).fetchone():
        raise HTTPException(status_code=404, detail="分类不存在")
    fields, values = [], []
    if payload.name is not None:
        fields.append("name = ?")
        values.append(payload.name.strip()[:10] or "分类")
    if payload.icon is not None:
        fields.append("icon = ?")
        values.append(payload.icon[:4])
    if payload.color is not None:
        fields.append("color = ?")
        values.append(payload.color)
    if payload.archived is not None:
        fields.append("archived = ?")
        values.append(1 if payload.archived else 0)
    if fields:
        values.append(category_id)
        conn.execute(f"UPDATE categories SET {', '.join(fields)} WHERE id = ?", values)
        conn.commit()
    return {"ok": True}


@app.delete("/api/categories/{category_id}")
def delete_category(category_id: int, user: dict = Depends(require("manage_categories")), conn: sqlite3.Connection = Depends(get_db)):
    # 删一级分类时连同其二级分类一起归档（流水保留，仍能显示原分类名）
    conn.execute("UPDATE categories SET archived = 1 WHERE parent_id = ?", (category_id,))
    conn.execute("UPDATE categories SET archived = 1 WHERE id = ?", (category_id,))
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 流水
@app.get("/api/transactions")
def list_transactions(
    month: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    kind: Optional[str] = None,
    user_id: Optional[int] = None,
    q: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = 0,
    user: dict = Depends(current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    where = ["1=1"]
    args: list = []
    if month:
        s, e = month_bounds(month)
        where.append("t.date BETWEEN ? AND ?")
        args += [s, e]
    else:
        if start:
            where.append("t.date >= ?")
            args.append(valid_date(start))
        if end:
            where.append("t.date <= ?")
            args.append(valid_date(end))
    if kind in ("income", "expense", "transfer"):
        where.append("t.kind = ?")
        args.append(kind)
    if user_id:
        where.append("t.user_id = ?")
        args.append(user_id)
    if q:
        where.append("t.note LIKE ?")
        args.append(f"%{q.strip()[:40]}%")

    sc, sc_args = scope_clause(user)
    sql_where = " AND ".join(where) + sc

    total = conn.execute(
        f"SELECT COUNT(*) c FROM transactions t WHERE {sql_where}", args + list(sc_args)
    ).fetchone()["c"]
    rows = conn.execute(
        f"""
        SELECT t.*, c.name AS cat_name, c.icon AS cat_icon, c.color AS cat_color,
               a.name AS acc_name, a.icon AS acc_icon,
               a2.name AS to_acc_name, a2.icon AS to_acc_icon,
               u.display_name AS user_name, u.color AS user_color
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN accounts a2 ON a2.id = t.to_account_id
        JOIN users u ON u.id = t.user_id
        WHERE {sql_where}
        ORDER BY t.date DESC, t.id DESC
        LIMIT ? OFFSET ?
        """,
        args + list(sc_args) + [limit, offset],
    ).fetchall()
    return {"total": total, "items": [tx_public(r) for r in rows]}


def tx_public(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"],
        "kind": r["kind"],
        "amount": yuan(r["amount_cents"]),
        "date": r["date"],
        "note": r["note"],
        "category": (
            {"id": r["category_id"], "name": r["cat_name"], "icon": r["cat_icon"], "color": r["cat_color"]}
            if r["cat_name"]
            else None
        ),
        "account": (
            {"id": r["account_id"], "name": r["acc_name"], "icon": r["acc_icon"]} if r["acc_name"] else None
        ),
        "to_account": (
            {"id": r["to_account_id"], "name": r["to_acc_name"], "icon": r["to_acc_icon"]}
            if r["to_acc_name"]
            else None
        ),
        "user": {"id": r["user_id"], "display_name": r["user_name"], "color": r["user_color"]},
        "created_at": r["created_at"],
    }


def check_tx_payload(payload: TxIn, conn: sqlite3.Connection) -> None:
    if payload.kind not in ("income", "expense", "transfer"):
        raise HTTPException(status_code=400, detail="流水类型不合法")
    if payload.amount is None or to_cents(payload.amount) <= 0:
        raise HTTPException(status_code=400, detail="金额需大于 0")
    if to_cents(payload.amount) > 100_000_000_00:
        raise HTTPException(status_code=400, detail="金额过大")
    if payload.kind == "transfer":
        if not payload.account_id or not payload.to_account_id:
            raise HTTPException(status_code=400, detail="请选择转出与转入账户")
        if payload.account_id == payload.to_account_id:
            raise HTTPException(status_code=400, detail="转出与转入账户不能相同")
    if payload.category_id and not conn.execute(
        "SELECT 1 FROM categories WHERE id = ?", (payload.category_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="分类不存在")


@app.post("/api/transactions")
def create_transaction(payload: TxIn, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    if payload.kind == "income" and not has_perm(user, "record_income"):
        raise HTTPException(status_code=403, detail="没有记收入的权限")
    if payload.kind in ("expense", "transfer") and not has_perm(user, "record_expense"):
        raise HTTPException(status_code=403, detail="没有记支出的权限")
    check_tx_payload(payload, conn)
    now = now_iso()
    cur = conn.execute(
        "INSERT INTO transactions(kind, amount_cents, category_id, account_id, to_account_id, user_id, date, note, created_at, updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?,?)",
        (
            payload.kind,
            to_cents(payload.amount),
            None if payload.kind == "transfer" else payload.category_id,
            payload.account_id,
            payload.to_account_id if payload.kind == "transfer" else None,
            user["id"],
            valid_date(payload.date),
            clean_note(payload.note),
            now,
            now,
        ),
    )
    conn.commit()
    return {"id": cur.lastrowid}


@app.put("/api/transactions/{tx_id}")
def update_transaction(
    tx_id: int,
    payload: TxIn,
    user: dict = Depends(current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    row = get_tx_or_404(conn, tx_id)
    assert_can_modify(user, row)
    check_tx_payload(payload, conn)
    conn.execute(
        "UPDATE transactions SET kind=?, amount_cents=?, category_id=?, account_id=?, to_account_id=?, "
        "date=?, note=?, updated_at=? WHERE id=?",
        (
            payload.kind,
            to_cents(payload.amount),
            None if payload.kind == "transfer" else payload.category_id,
            payload.account_id,
            payload.to_account_id if payload.kind == "transfer" else None,
            valid_date(payload.date),
            clean_note(payload.note),
            now_iso(),
            tx_id,
        ),
    )
    conn.commit()
    return {"ok": True}


@app.delete("/api/transactions/{tx_id}")
def delete_transaction(tx_id: int, user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    row = get_tx_or_404(conn, tx_id)
    assert_can_modify(user, row)
    conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    conn.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 统计
@app.get("/api/stats")
def stats(
    month: Optional[str] = None,
    user: dict = Depends(current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    """月度统计。数据范围由 view_all 权限决定（只能看自己的 / 看全家），
    是否展示统计页由前端按 view_reports 控制。"""
    month = valid_month(month) if month else datetime.now().strftime("%Y-%m")
    start, end = month_bounds(month)
    pm = prev_month(month)
    pstart, pend = month_bounds(pm)
    sc, sc_args = scope_clause(user)

    def sum_kind(kind: str, s: str, e: str) -> int:
        row = conn.execute(
            f"SELECT COALESCE(SUM(amount_cents),0) s FROM transactions t "
            f"WHERE t.kind=? AND t.date BETWEEN ? AND ?{sc}",
            (kind, s, e) + sc_args,
        ).fetchone()
        return row["s"]

    income = sum_kind("income", start, end)
    expense = sum_kind("expense", start, end)
    p_income = sum_kind("income", pstart, pend)
    p_expense = sum_kind("expense", pstart, pend)

    cat_rows = conn.execute(
        f"""
        SELECT COALESCE(t.category_id, 0) cid, COALESCE(c.name,'未分类') cname,
               COALESCE(c.icon,'📦') cicon, COALESCE(c.color,'#8A8578') ccolor,
               c.parent_id pid, p.name pname, p.icon picon, p.color pcolor,
               t.kind, SUM(t.amount_cents) total
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN categories p ON p.id = c.parent_id
        WHERE t.date BETWEEN ? AND ? AND t.kind IN ('income','expense'){sc}
        GROUP BY t.kind, cid
        ORDER BY total DESC
        """,
        (start, end) + sc_args,
    ).fetchall()

    cat_map: dict[str, list] = {"income": [], "expense": []}
    base = {"income": income, "expense": expense}
    for r in cat_rows:
        total = r["total"]
        denom = base[r["kind"]] or 1
        # 一级分类本身被直接记账时（移植数据/自定义），归到自己名下
        top = r["pid"] or r["cid"]
        cat_map[r["kind"]].append(
            {
                "id": r["cid"],
                "name": r["cname"],
                "icon": r["cicon"],
                "color": r["ccolor"],
                "parent_id": top if r["pid"] else None,
                "parent_name": r["pname"] if r["pid"] else r["cname"],
                "parent_icon": r["picon"] if r["pid"] else r["cicon"],
                "parent_color": r["pcolor"] if r["pid"] else r["ccolor"],
                "amount": yuan(total),
                "pct": round(total * 100 / denom, 1),
            }
        )


    daily_rows = conn.execute(
        f"""
        SELECT t.date d, t.kind, SUM(t.amount_cents) total
        FROM transactions t
        WHERE t.date BETWEEN ? AND ? AND t.kind IN ('income','expense'){sc}
        GROUP BY t.date, t.kind
        """,
        (start, end) + sc_args,
    ).fetchall()
    daily: dict[str, dict] = {}
    d0 = dt_date.fromisoformat(start)
    d1 = dt_date.fromisoformat(end)
    cur = d0
    while cur <= d1:
        daily[cur.isoformat()] = {"date": cur.isoformat(), "income": 0, "expense": 0}
        cur += timedelta(days=1)
    for r in daily_rows:
        if r["d"] in daily:
            daily[r["d"]][r["kind"]] = yuan(r["total"])

    member_rows = conn.execute(
        f"""
        SELECT u.id, u.display_name, u.color, t.kind,
               SUM(t.amount_cents) total, COUNT(*) cnt
        FROM transactions t JOIN users u ON u.id = t.user_id
        WHERE t.date BETWEEN ? AND ? AND t.kind IN ('income','expense'){sc}
        GROUP BY u.id, t.kind
        """,
        (start, end) + sc_args,
    ).fetchall()
    members_map: dict[int, dict] = {}
    for r in member_rows:
        item = members_map.setdefault(
            r["id"],
            {"id": r["id"], "name": r["display_name"], "color": r["color"], "income": 0, "expense": 0, "count": 0},
        )
        item[r["kind"]] = yuan(r["total"])
        item["count"] += r["cnt"]
    members_sorted = sorted(members_map.values(), key=lambda m: m["expense"], reverse=True)

    # 近 6 个月趋势
    trend_start = dt_date.fromisoformat(start)
    y, m = trend_start.year, trend_start.month
    months: list[str] = []
    for _ in range(6):
        months.append(f"{y}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    months.reverse()
    trend = []
    for mm in months:
        trend.append(
            {
                "month": mm,
                "label": f"{int(mm[5:7])}月",
                "income": yuan(sum_kind("income", *month_bounds(mm))),
                "expense": yuan(sum_kind("expense", *month_bounds(mm))),
            }
        )

    budget_row = conn.execute("SELECT amount_cents FROM budgets WHERE month = ?", (month,)).fetchone()
    budget = None
    if budget_row and budget_row["amount_cents"] > 0:
        b = budget_row["amount_cents"]
        budget = {
            "amount": yuan(b),
            "used": yuan(expense),
            "pct": round(expense * 100 / b, 1),
            "left": yuan(max(b - expense, 0)),
        }

    return {
        "month": month,
        "income": yuan(income),
        "expense": yuan(expense),
        "balance": yuan(income - expense),
        "prev_income": yuan(p_income),
        "prev_expense": yuan(p_expense),
        "categories": cat_map,
        "daily": list(daily.values()),
        "members": members_sorted,
        "trend": trend,
        "budget": budget,
        "accounts": account_rows(conn),
    }


# ---------------------------------------------------------------- 预算
@app.get("/api/budgets")
def list_budgets(user: dict = Depends(current_user), conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute("SELECT * FROM budgets ORDER BY month DESC LIMIT 24").fetchall()
    return [{"month": r["month"], "amount": yuan(r["amount_cents"])} for r in rows]


@app.post("/api/budgets")
def set_budget(payload: BudgetIn, user: dict = Depends(require("manage_budgets")), conn: sqlite3.Connection = Depends(get_db)):
    month = valid_month(payload.month)
    cents = max(to_cents(payload.amount), 0)
    conn.execute(
        "INSERT INTO budgets(month, amount_cents) VALUES(?,?) "
        "ON CONFLICT(month) DO UPDATE SET amount_cents = excluded.amount_cents",
        (month, cents),
    )
    conn.commit()
    return {"month": month, "amount": yuan(cents)}


# ---------------------------------------------------------------- 设置 / 导出
class SiteIn(BaseModel):
    site_name: str


@app.post("/api/settings/site")
def set_site(payload: SiteIn, admin: dict = Depends(require_admin), conn: sqlite3.Connection = Depends(get_db)):
    name = payload.site_name.strip()[:20]
    if not name:
        raise HTTPException(status_code=400, detail="请填写名称")
    set_setting(conn, "site_name", name)
    conn.commit()
    return {"site_name": name}


@app.get("/api/export")
def export_csv(
    month: Optional[str] = None,
    user: dict = Depends(current_user),
    conn: sqlite3.Connection = Depends(get_db),
):
    where = ["1=1"]
    args: list = []
    if month:
        s, e = month_bounds(month)
        where.append("t.date BETWEEN ? AND ?")
        args += [s, e]
    sc, sc_args = scope_clause(user)
    rows = conn.execute(
        f"""
        SELECT t.date, t.kind, t.amount_cents, COALESCE(c.name,'未分类') cat,
               COALESCE(p.name,'') pcat,
               COALESCE(a.name,'-') acc, COALESCE(a2.name,'-') to_acc,
               t.note, u.display_name uname
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN categories p ON p.id = c.parent_id
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN accounts a2 ON a2.id = t.to_account_id
        JOIN users u ON u.id = t.user_id
        WHERE {' AND '.join(where)}{sc}
        ORDER BY t.date DESC, t.id DESC
        """,
        args + list(sc_args),
    ).fetchall()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["日期", "类型", "一级分类", "分类", "金额(元)", "账户", "转入账户", "备注", "记录人"])
    kind_label = {"income": "收入", "expense": "支出", "transfer": "转账"}
    for r in rows:
        writer.writerow(
            [
                r["date"],
                kind_label.get(r["kind"], r["kind"]),
                r["pcat"],
                r["cat"],
                f"{r['amount_cents'] / 100:.2f}",
                r["acc"],
                r["to_acc"],
                r["note"],
                r["uname"],
            ]
        )
    filename = f"family-ledger-{month or 'all'}.csv"
    return Response(
        content="\ufeff" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------- 前端静态资源
@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(STATIC_DIR / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def service_worker():
    return FileResponse(STATIC_DIR / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
