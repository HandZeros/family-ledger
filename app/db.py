"""SQLite 数据访问层：建表、种子数据、连接管理。

金额统一以「分」(INTEGER) 存储，避免浮点误差；对外 API 再换算成元。
"""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR") or (BASE_DIR / "data"))
DB_PATH = Path(os.environ.get("DB_PATH") or (DATA_DIR / "ledger.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    role          TEXT NOT NULL DEFAULT 'member',      -- admin | member
    perms         TEXT NOT NULL DEFAULT '[]',          -- JSON 数组
    is_active     INTEGER NOT NULL DEFAULT 1,
    color         TEXT NOT NULL DEFAULT '#2E6B5A',
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    icon          TEXT NOT NULL DEFAULT '💰',
    type          TEXT NOT NULL DEFAULT 'cash',        -- cash/bank/wechat/alipay/credit/other
    initial_cents INTEGER NOT NULL DEFAULT 0,
    owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    archived      INTEGER NOT NULL DEFAULT 0,
    sort          INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'expense',        -- income | expense
    icon       TEXT NOT NULL DEFAULT '📦',
    color      TEXT NOT NULL DEFAULT '#8A8578',
    sort       INTEGER NOT NULL DEFAULT 0,
    archived   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL,                       -- income | expense | transfer
    amount_cents  INTEGER NOT NULL,
    category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    to_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,                       -- YYYY-MM-DD
    note          TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    month        TEXT NOT NULL UNIQUE,                 -- YYYY-MM
    amount_cents INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_kind ON transactions(kind);
"""

EXPENSE_SEED = [
    ("餐饮", "🍜", "#E2584A"),
    ("买菜", "🥬", "#4C9A5E"),
    ("交通", "🚌", "#4A7DBB"),
    ("日用", "🧻", "#9B7EBD"),
    ("购物", "🛍️", "#D9739B"),
    ("住房", "🏠", "#B07A4E"),
    ("水电", "💡", "#D9A23B"),
    ("通讯", "📱", "#4E9CA6"),
    ("医疗", "💊", "#CF5D6B"),
    ("教育", "📚", "#5B7FA6"),
    ("娱乐", "🎮", "#8A6FBF"),
    ("人情", "🎁", "#D2694E"),
    ("宠物", "🐾", "#A1876B"),
    ("其他", "📦", "#8A8578"),
]

INCOME_SEED = [
    ("工资", "💰", "#2E9E76"),
    ("奖金", "🎉", "#D9A23B"),
    ("理财", "📈", "#3E8E7E"),
    ("红包", "🧧", "#D2493F"),
    ("报销", "🧾", "#5B7FA6"),
    ("其他", "💵", "#8A8578"),
]

ACCOUNT_SEED = [
    ("现金", "💵", "cash"),
    ("微信", "💚", "wechat"),
    ("支付宝", "💙", "alipay"),
    ("银行卡", "🏦", "bank"),
]


def now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False：FastAPI 的同步端点在线程池中执行，同一个请求的
    # 依赖与处理函数可能落在不同线程，因此关闭 sqlite 的线程校验。
    # 每个请求使用独立连接，不存在并发共享同一连接的情况。
    conn = sqlite3.connect(DB_PATH, timeout=20, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=8000")
    return conn


@contextmanager
def db_session():
    conn = get_conn()
    try:
        yield conn
    finally:
        conn.close()


def get_setting(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def init_db() -> None:
    """建表并写入默认分类/账户（仅首次）。"""
    with db_session() as conn:
        conn.executescript(SCHEMA)

        if conn.execute("SELECT COUNT(*) c FROM categories").fetchone()["c"] == 0:
            rows = []
            for i, (name, icon, color) in enumerate(EXPENSE_SEED):
                rows.append((name, "expense", icon, color, i))
            for i, (name, icon, color) in enumerate(INCOME_SEED):
                rows.append((name, "income", icon, color, i))
            conn.executemany(
                "INSERT INTO categories(name, kind, icon, color, sort) VALUES(?,?,?,?,?)",
                rows,
            )

        if conn.execute("SELECT COUNT(*) c FROM accounts").fetchone()["c"] == 0:
            conn.executemany(
                "INSERT INTO accounts(name, icon, type, sort, created_at) VALUES(?,?,?,?,?)",
                [(name, icon, typ, i, now_iso()) for i, (name, icon, typ) in enumerate(ACCOUNT_SEED)],
            )

        if not get_setting(conn, "jwt_secret"):
            import secrets

            set_setting(conn, "jwt_secret", secrets.token_hex(32))
        if not get_setting(conn, "site_name"):
            set_setting(conn, "site_name", "家庭账本")
        conn.commit()
