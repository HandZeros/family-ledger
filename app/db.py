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
    parent_id  INTEGER REFERENCES categories(id) ON DELETE CASCADE,  -- NULL 为一级分类
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

# 分类体系参考「随手记」：一级分类分组，二级分类记账。
# 结构为 (一级名称, 一级图标, 一级颜色, [(二级名称, 二级图标), ...])
EXPENSE_TREE = [
    ("食品酒水", "🍚", "#E2584A", [
        ("伙食费", "🍚"), ("早餐", "🥣"), ("中餐", "🍜"), ("晚餐", "🍲"),
        ("水果", "🍎"), ("零食", "🍿"), ("买菜", "🥬"), ("柴米油盐", "🧂"),
        ("饮料酒水", "🥤"), ("外出美食", "🍽️"), ("夜宵", "🌙"),
    ]),
    ("居家生活", "🏠", "#B07A4E", [
        ("房租", "🏠"), ("物业费", "🏢"), ("电费", "💡"), ("水费", "🚰"),
        ("燃气费", "🔥"), ("电视费", "📺"), ("维修费", "🔧"), ("快递费", "📦"),
    ]),
    ("交流通讯", "📱", "#4E9CA6", [
        ("手机话费", "📱"), ("网费", "🌐"), ("座机费", "☎️"),
    ]),
    ("休闲娱乐", "🎮", "#8A6FBF", [
        ("彩票", "🎟️"), ("棋牌", "🃏"), ("麻将", "🀄"), ("话剧", "🎭"),
        ("K歌", "🎤"), ("网游", "🕹️"), ("运动", "🏃"), ("电影", "🎬"),
        ("演唱会", "🎫"), ("温泉洗浴", "♨️"), ("其他娱乐", "🎉"),
        ("聚会", "🥂"), ("夹娃娃", "🧸"),
    ]),
    ("人情费用", "🎁", "#D2694E", [
        ("红包", "🧧"), ("白事", "🕯️"), ("升学", "🎓"), ("满月", "👶"),
        ("寿辰", "🎂"), ("婚嫁", "💍"), ("乔迁", "🏡"), ("孝敬长辈", "👴"),
        ("请客", "🍽️"), ("送礼", "🎁"),
    ]),
    ("宝宝费用", "👶", "#D9739B", [
        ("妈妈用品", "👩"), ("医疗护理", "🩺"), ("宝宝用品", "🍼"),
        ("宝宝教育", "📚"), ("宝宝食品", "🥣"), ("宝宝其他", "🧸"), ("产检", "🏥"),
    ]),
    ("出差旅游", "✈️", "#4A7DBB", [
        ("餐饮费", "🍽️"), ("交通费", "🚕"), ("住宿费", "🏨"), ("娱乐费", "🎡"),
        ("出行用品", "🎒"), ("其他消费", "💳"), ("景点门票", "🎫"), ("旅游购物", "🛍️"),
    ]),
    ("行车交通", "🚗", "#3E7B9E", [
        ("地铁", "🚇"), ("公交", "🚌"), ("保养", "🛠️"), ("保险", "🛡️"),
        ("违章罚款", "🚨"), ("停车", "🅿️"), ("维修", "🔧"), ("驾照", "🪪"),
        ("自行车", "🚲"), ("加油", "⛽"), ("租车", "🚙"), ("飞机", "✈️"),
        ("火车", "🚄"), ("打车", "🚕"), ("电瓶车充电", "🔌"),
    ]),
    ("购物消费", "🛍️", "#D9739B", [
        ("日常用品", "🧻"), ("电子数码", "💻"), ("美妆护肤", "💄"), ("洗护用品", "🧴"),
        ("衣裤鞋帽", "👕"), ("超市购物", "🛒"), ("书报杂志", "📰"), ("运动器械", "🏋️"),
        ("厨房用品", "🍳"), ("家居饰品", "🖼️"), ("珠宝首饰", "💎"), ("宠物支出", "🐾"),
        ("办公用品", "✏️"), ("家具家电", "🛋️"), ("清洁用品", "🧽"), ("汽车用品", "🚘"),
        ("家用纺织", "🧵"), ("老婆网购", "💝"), ("网购", "📦"),
    ]),
    ("医疗教育", "🏥", "#CF5D6B", [
        ("治疗费", "💉"), ("药品费", "💊"), ("住院费", "🏥"), ("护理费", "🩺"), ("学费", "🎓"),
    ]),
    ("其他杂项", "📦", "#8A8578", [
        ("烂账损失", "💸"), ("意外丢失", "🫥"), ("其他支出", "📦"),
    ]),
    ("装修费用", "🏗️", "#A1876B", [
        ("装修材料", "🧱"), ("装修人工", "👷"), ("家电家具", "🛋️"),
        ("装修装饰", "🖼️"), ("装修其他", "🏗️"),
    ]),
    ("金融保险", "💳", "#2E9E76", [
        ("车贷手续", "📄"), ("汽车首付", "🚗"), ("车贷", "🚙"), ("投资亏损", "📉"),
        ("人身保险", "🛡️"), ("按揭还款", "🏦"), ("银行手续", "🏛️"), ("利息支出", "💸"),
        ("房屋首付", "🏠"), ("房贷", "🏡"), ("房贷手续", "📃"), ("税费", "🧾"),
        ("赔偿罚款", "⚖️"), ("消费税收", "💰"),
    ]),
]

INCOME_TREE = [
    ("职业收入", "💼", "#2E9E76", [
        ("工资", "💰"), ("奖金", "🎉"), ("津贴", "🎖️"), ("加班费", "⏰"),
        ("绩效", "🏆"), ("年终奖", "🧨"), ("提成", "📈"),
    ]),
    ("兼职收入", "🧑‍💻", "#4A7DBB", [
        ("兼职", "💼"), ("外快", "💵"), ("稿费", "✍️"), ("直播", "📹"),
    ]),
    ("投资收入", "📈", "#3E8E7E", [
        ("利息", "🏦"), ("股息", "📊"), ("基金收益", "📈"),
        ("股票收益", "📉"), ("理财收益", "💹"), ("房租收入", "🏠"),
    ]),
    ("其他收入", "💵", "#8A8578", [
        ("红包", "🧧"), ("礼金", "🎁"), ("报销", "🧾"),
        ("退款", "↩️"), ("中奖", "🎰"), ("意外所得", "🍀"), ("其他", "💵"),
    ]),
]

# 旧版（1.1 及以前）扁平分类 → 新版二级分类的映射，升级时用于迁移已有流水
LEGACY_MAP = {
    ("expense", "餐饮"): "伙食费",
    ("expense", "买菜"): "买菜",
    ("expense", "交通"): "打车",
    ("expense", "日用"): "日常用品",
    ("expense", "购物"): "超市购物",
    ("expense", "住房"): "房租",
    ("expense", "水电"): "电费",
    ("expense", "通讯"): "手机话费",
    ("expense", "医疗"): "治疗费",
    ("expense", "教育"): "学费",
    ("expense", "娱乐"): "其他娱乐",
    ("expense", "人情"): "红包",
    ("expense", "宠物"): "宠物支出",
    ("expense", "其他"): "其他支出",
    ("income", "工资"): "工资",
    ("income", "奖金"): "奖金",
    ("income", "理财"): "理财收益",
    ("income", "红包"): "红包",
    ("income", "报销"): "报销",
    ("income", "其他"): "其他",
}


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


def _seed_category_tree(conn: sqlite3.Connection) -> None:
    """写入两级分类树（父分类 parent_id 为 NULL）。"""
    tree = [("expense", EXPENSE_TREE), ("income", INCOME_TREE)]
    for kind, groups in tree:
        for gi, (pname, picon, pcolor, children) in enumerate(groups):
            cur = conn.execute(
                "INSERT INTO categories(name, kind, icon, color, parent_id, sort) VALUES(?,?,?,?,NULL,?)",
                (pname, kind, picon, pcolor, gi),
            )
            pid = cur.lastrowid
            conn.executemany(
                "INSERT INTO categories(name, kind, icon, color, parent_id, sort) VALUES(?,?,?,?,?,?)",
                [(cname, kind, cicon, pcolor, pid, ci) for ci, (cname, cicon) in enumerate(children)],
            )


def _migrate_category_tree(conn: sqlite3.Connection) -> None:
    """把 1.1 及以前的扁平分类升级为两级分类。

    - 已有流水按 LEGACY_MAP 重新挂到对应的二级分类，不丢历史；
    - 用户自建的分类无法映射时，挂到「其他支出 / 其他收入」下保留原名字；
    - 旧分类置为归档（GET 不再返回），避免列表里出现重复项。
    """
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(categories)").fetchall()}
    if "parent_id" not in cols:
        conn.execute("ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)")

    if get_setting(conn, "categories_v2") == "1":
        return

    legacy = conn.execute("SELECT * FROM categories WHERE archived = 0").fetchall()
    _seed_category_tree(conn)

    leaf = {}
    for r in conn.execute("SELECT id, name, kind FROM categories WHERE parent_id IS NOT NULL").fetchall():
        leaf.setdefault((r["kind"], r["name"]), r["id"])
    parent_of = {
        r["name"]: r["id"]
        for r in conn.execute("SELECT id, name FROM categories WHERE parent_id IS NULL AND kind = ?", ("expense",))
    }
    parent_of_inc = {
        r["name"]: r["id"]
        for r in conn.execute("SELECT id, name FROM categories WHERE parent_id IS NULL AND kind = ?", ("income",))
    }

    for old in legacy:
        if old["parent_id"] is not None:
            continue
        kind = old["kind"] if old["kind"] in ("expense", "income") else "expense"
        target = leaf.get((kind, LEGACY_MAP.get((kind, old["name"]), "")))
        if target is None:
            # 用户自建分类：挂到该类型的「其他」分组下，保留名字与图标
            pid = parent_of.get("其他杂项") if kind == "expense" else parent_of_inc.get("其他收入")
            sort = conn.execute(
                "SELECT COALESCE(MAX(sort),0)+1 s FROM categories WHERE parent_id = ?", (pid,)
            ).fetchone()["s"]
            target = conn.execute(
                "INSERT INTO categories(name, kind, icon, color, parent_id, sort) VALUES(?,?,?,?,?,?)",
                (old["name"], kind, old["icon"], old["color"], pid, sort),
            ).lastrowid
        conn.execute("UPDATE transactions SET category_id = ? WHERE category_id = ?", (target, old["id"]))
        conn.execute("UPDATE categories SET archived = 1 WHERE id = ?", (old["id"],))

    set_setting(conn, "categories_v2", "1")


def init_db() -> None:
    """建表并写入默认分类/账户（仅首次）。"""
    with db_session() as conn:
        conn.executescript(SCHEMA)

        if conn.execute("SELECT COUNT(*) c FROM categories").fetchone()["c"] == 0:
            _seed_category_tree(conn)
            set_setting(conn, "categories_v2", "1")
        else:
            _migrate_category_tree(conn)

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
