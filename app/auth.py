"""认证与权限：scrypt 密码哈希、HMAC 签名令牌、权限依赖。"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from typing import Optional

from fastapi import Depends, Header, HTTPException

from .db import get_conn, get_setting

TOKEN_TTL = 60 * 60 * 24 * 30  # 30 天

# ---- 权限点 ----------------------------------------------------------------
PERMISSIONS = [
    ("record_expense", "记支出"),
    ("record_income", "记收入"),
    ("edit_own", "改删自己的记录"),
    ("view_all", "查看全家账本"),
    ("view_reports", "查看统计报表"),
    ("manage_accounts", "管理账户"),
    ("manage_categories", "管理分类"),
    ("manage_budgets", "管理预算"),
]
PERM_KEYS = [k for k, _ in PERMISSIONS]
DEFAULT_MEMBER_PERMS = ["record_expense", "record_income", "edit_own"]


# ---- 密码 ------------------------------------------------------------------
def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(txt: str) -> bytes:
    return base64.urlsafe_b64decode(txt + "=" * (-len(txt) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${_b64e(salt)}${_b64e(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, dk = stored.split("$")
        if algo != "scrypt":
            return False
        calc = hashlib.scrypt(
            password.encode("utf-8"),
            salt=_b64d(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(_b64d(dk)),
        )
        return hmac.compare_digest(calc, _b64d(dk))
    except Exception:
        return False


# ---- 令牌 ------------------------------------------------------------------
def make_token(user_id: int, version: int, secret: str, ttl: int = TOKEN_TTL) -> str:
    payload = {"uid": user_id, "v": version, "exp": int(time.time()) + ttl}
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode())
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()[:40]
    return f"{body}.{sig}"


def parse_token(token: str, secret: str) -> Optional[dict]:
    try:
        body, sig = token.split(".")
        expect = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()[:40]
        if not hmac.compare_digest(sig, expect):
            return None
        payload = json.loads(_b64d(body))
        if int(payload.get("exp", 0)) < time.time():
            return None
        return payload
    except Exception:
        return None


# ---- 依赖 ------------------------------------------------------------------
def get_db():
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()


def user_public(row) -> dict:
    perms = json.loads(row["perms"] or "[]")
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"] or row["username"],
        "role": row["role"],
        "perms": perms,
        "is_active": bool(row["is_active"]),
        "color": row["color"],
        "created_at": row["created_at"],
    }


def load_user(conn: sqlite3.Connection, user_id: int) -> Optional[dict]:
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row or not row["is_active"]:
        return None
    return user_public(row)


def current_user(
    conn: sqlite3.Connection = Depends(get_db),
    authorization: Optional[str] = Header(None),
) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="请先登录")
    token = authorization.split(" ", 1)[1].strip()
    secret = get_setting(conn, "jwt_secret")
    payload = parse_token(token, secret)
    if not payload:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    row = conn.execute("SELECT * FROM users WHERE id = ?", (payload["uid"],)).fetchone()
    if not row or not row["is_active"] or int(payload["v"]) != row["token_version"]:
        raise HTTPException(status_code=401, detail="账号状态已变更，请重新登录")
    return user_public(row)


def has_perm(user: dict, perm: str) -> bool:
    return user["role"] == "admin" or perm in user["perms"]


def require(perm: str):
    def dep(user: dict = Depends(current_user)) -> dict:
        if not has_perm(user, perm):
            raise HTTPException(status_code=403, detail="没有该操作权限")
        return user

    return dep


def require_admin(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可操作")
    return user
