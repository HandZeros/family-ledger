#!/usr/bin/env python3
"""家庭账本镜像自检脚本。

在镜像构建完成后（或本地 docker run 之后）跑一遍关键链路，确保镜像可正常使用：
  健康检查 -> 首次初始化 -> 登录 -> 默认账户/分类 -> 记一笔 -> 统计 -> 前端资源

用法：
    python3 scripts/docker-smoke.py --base http://127.0.0.1:5257
退出码 0 表示全部通过。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5257"
TOKEN = ""
PASSED: list[str] = []


def call(method: str, path: str, body: dict | None = None, token: str | None = None, raw: bool = False):
    """发一个请求，返回 (status, payload)。raw=True 时返回原始文本。"""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8", "replace")
            return resp.status, (text if raw else json.loads(text or "null"))
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(text or "null")
        except json.JSONDecodeError:
            return e.code, text


def ok(label: str, cond: bool, detail: str = "") -> None:
    if cond:
        PASSED.append(label)
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        print(f"  \033[31mFAIL\033[0m {label} {detail}")
        raise SystemExit(1)


def wait_ready(timeout: int = 60) -> None:
    print(f"[0] 等待服务就绪（最多 {timeout}s）")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            code, payload = call("GET", "/api/health")
            if code == 200 and payload.get("status") == "ok":
                print("  \033[32mPASS\033[0m /api/health")
                return
        except Exception:
            pass
        time.sleep(1)
    print("  \033[31mFAIL\033[0m 服务未在超时时间内就绪")
    raise SystemExit(1)


def main() -> int:
    global BASE, TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="family123")
    args = ap.parse_args()
    BASE = args.base.rstrip("/")

    wait_ready()

    print("[1] 未初始化状态")
    code, st = call("GET", "/api/status")
    ok("/api/status 200", code == 200, str(st))
    if st.get("setup_done"):
        print("  \033[33mSKIP\033[0m 该数据卷已初始化，跳过 setup（改用登录）")
        code, res = call("POST", "/api/auth/login", {"username": args.user, "password": args.password})
        ok("登录成功", code == 200 and res.get("token"), str(res)[:200])
        TOKEN = res["token"]
    else:
        call("POST", "/api/setup", {
            "username": args.user,
            "password": args.password,
            "display_name": "管理员",
            "site_name": "家庭账本",
        })
        code, res = call("POST", "/api/setup", {"username": "dup", "password": "family123"})
        ok("重复初始化被拒绝", code == 400, str(res))
        code, res = call("POST", "/api/auth/login", {"username": args.user, "password": args.password})
        ok("管理员登录拿到 token", code == 200 and bool(res.get("token")), str(res)[:200])
        TOKEN = res["token"]

    print("[2] 登录态接口")
    code, me = call("GET", "/api/auth/me", token=TOKEN)
    ok("/api/auth/me", code == 200 and me.get("user", {}).get("role") == "admin", str(me)[:200])

    code, accounts = call("GET", "/api/accounts", token=TOKEN)
    ok("默认账户已创建", code == 200 and len(accounts) >= 1, f"{len(accounts)} 个")
    code, cats = call("GET", "/api/categories", token=TOKEN)
    ok("默认分类已创建", code == 200 and len(cats) >= 10, f"{len(cats)} 个")

    print("[3] 记账链路")
    expense_cat = next((c for c in cats if c.get("kind") == "expense"), None)
    ok("存在支出分类", expense_cat is not None)
    today = time.strftime("%Y-%m-%d")
    code, tx = call("POST", "/api/transactions", {
        "kind": "expense",
        "amount": 12.5,
        "category_id": expense_cat["id"],
        "account_id": accounts[0]["id"],
        "date": today,
        "note": "镜像自检",
    }, token=TOKEN)
    ok("新增一笔支出", code in (200, 201) and tx.get("id"), str(tx)[:200])

    code, lst = call("GET", "/api/transactions", token=TOKEN)
    ok("流水可查询且包含刚写入的记录", code == 200 and any(t.get("id") == tx["id"] for t in lst.get("items", lst) if isinstance(t, dict)), "")

    code, stats = call("GET", "/api/stats", token=TOKEN)
    ok("/api/stats 200", code == 200, str(stats)[:200])

    code, upd = call("PUT", f"/api/transactions/{tx['id']}", {
        "kind": "expense",
        "amount": 20,
        "category_id": expense_cat["id"],
        "account_id": accounts[0]["id"],
        "date": today,
        "note": "镜像自检-已修改",
    }, token=TOKEN)
    ok("修改流水", code in (200, 201), str(upd)[:200])
    code, _ = call("DELETE", f"/api/transactions/{tx['id']}", token=TOKEN)
    ok("删除流水", code in (200, 204), "")

    print("[4] 前端与 PWA 资源")
    for path, must_contain in [("/", "<html"), ("/manifest.webmanifest", "name"), ("/sw.js", "addEventListener")]:
        code, text = call("GET", path, raw=True)
        ok(f"{path} 可访问", code == 200 and must_contain in text, f"status={code}")

    code, _ = call("GET", "/api/transactions")
    ok("未登录访问被拒绝", code == 401, str(code))

    print(f"\n全部通过：{len(PASSED)} 项检查")
    return 0


if __name__ == "__main__":
    sys.exit(main())
