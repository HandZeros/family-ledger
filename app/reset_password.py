"""重置某个账号的密码（忘记密码时在容器内使用）。

用法：
    python -m app.reset_password <用户名> <新密码>
    docker compose exec family-ledger python -m app.reset_password admin newpass123
"""
import sys

from .auth import hash_password
from .db import db_session


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 1
    username, password = sys.argv[1].strip(), sys.argv[2]
    if len(password) < 6:
        print("密码至少 6 位")
        return 1
    with db_session() as conn:
        row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if not row:
            print(f"未找到用户：{username}")
            return 1
        conn.execute(
            "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
            (hash_password(password), row["id"]),
        )
        conn.commit()
    print(f"已重置 {username} 的密码，该账号此前的登录状态全部失效。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
