"""
Pharmacy Database Layer (SQLite)
Manages drug master, dispensing logs, categories, and audit trail.
"""

import sqlite3
import json
import secrets
import threading
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
from config import Config

_db_write_lock = threading.RLock()

BANGKOK_TZ = ZoneInfo("Asia/Bangkok")

def get_now_str():
    return datetime.now(BANGKOK_TZ).strftime("%Y-%m-%d %H:%M:%S")

def get_db():
    conn = sqlite3.connect(Config.DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    with conn:
        # Table: Drugs (Master Inventory)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS drugs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                generic_name TEXT,
                category TEXT DEFAULT 'ทั่วไป',
                dosage_form TEXT DEFAULT 'เม็ด (Tablet)',
                strength TEXT DEFAULT '',
                stock_qty INTEGER NOT NULL DEFAULT 0,
                unit TEXT DEFAULT 'เม็ด',
                min_threshold INTEGER DEFAULT 10,
                price REAL DEFAULT 0.0,
                cost REAL DEFAULT 0.0,
                expiry_date TEXT,
                lot_number TEXT DEFAULT '',
                location TEXT DEFAULT 'ตู้เก็บยาหลัก',
                qr_payload TEXT,
                instructions TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)

        # Migration: Ensure lot_number and image_url exist in existing databases
        try:
            conn.execute("ALTER TABLE drugs ADD COLUMN lot_number TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass

        try:
            conn.execute("ALTER TABLE drugs ADD COLUMN image_url TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass

        # Table: Dispensing Logs (Stock deductions)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dispensing_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                drug_id INTEGER,
                drug_code TEXT,
                drug_name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                balance_before INTEGER NOT NULL,
                balance_after INTEGER NOT NULL,
                channel TEXT DEFAULT 'WEB_MANUAL',
                dispensed_by TEXT DEFAULT 'เภสัชกร/เจ้าหน้าที่',
                patient_name TEXT,
                drive_file_id TEXT,
                drive_file_link TEXT,
                notes TEXT,
                synced_to_sheet INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                is_voided INTEGER DEFAULT 0,
                void_reason TEXT DEFAULT '',
                voided_by TEXT DEFAULT '',
                voided_at TEXT DEFAULT '',
                FOREIGN KEY (drug_id) REFERENCES drugs (id) ON DELETE SET NULL
            )
        """)

        # Migration: Ensure void tracking and batch_id columns exist in existing dispensing_logs
        for col, col_type in [("is_voided", "INTEGER DEFAULT 0"), ("void_reason", "TEXT DEFAULT ''"), ("voided_by", "TEXT DEFAULT ''"), ("voided_at", "TEXT DEFAULT ''"), ("batch_id", "TEXT DEFAULT ''")]:
            try:
                conn.execute(f"ALTER TABLE dispensing_logs ADD COLUMN {col} {col_type}")
            except sqlite3.OperationalError:
                pass

        # Migration: Ensure is_staff column exists in line_subscribers
        try:
            conn.execute("ALTER TABLE line_subscribers ADD COLUMN is_staff INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass

        # Table: Categories
        conn.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                color TEXT DEFAULT 'teal'
            )
        """)

        # Table: System Settings (e.g. Google Drive/Sheet configuration)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT
            )
        """)

        # Table: LINE Notification Subscribers (Users or Groups to alert)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS line_subscribers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_id TEXT UNIQUE NOT NULL,
                target_type TEXT DEFAULT 'user',
                display_name TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                created_at TEXT,
                last_active TEXT
            )
        """)

        # Table: Stock In / Receiving Logs (Batch & Lot Management)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS stock_in_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                drug_id INTEGER,
                drug_code TEXT,
                drug_name TEXT NOT NULL,
                lot_number TEXT,
                quantity INTEGER NOT NULL,
                balance_before INTEGER NOT NULL,
                balance_after INTEGER NOT NULL,
                cost_per_unit REAL DEFAULT 0.0,
                total_cost REAL DEFAULT 0.0,
                supplier TEXT DEFAULT 'องค์การเภสัชกรรม (GPO)',
                expiry_date TEXT,
                received_by TEXT DEFAULT 'เภสัชกร/เจ้าหน้าที่',
                notes TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (drug_id) REFERENCES drugs (id) ON DELETE SET NULL
            )
        """)

        # Migration: Ensure existing stock_in_logs allows NULL drug_id and ON DELETE SET NULL
        try:
            cur = conn.cursor()
            cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_in_logs'")
            row = cur.fetchone()
            if row and ("ON DELETE CASCADE" in row[0] or "drug_id INTEGER NOT NULL" in row[0]):
                conn.execute("PRAGMA foreign_keys = OFF")
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS stock_in_logs_migrated (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        drug_id INTEGER,
                        drug_code TEXT,
                        drug_name TEXT NOT NULL,
                        lot_number TEXT,
                        quantity INTEGER NOT NULL,
                        balance_before INTEGER NOT NULL,
                        balance_after INTEGER NOT NULL,
                        cost_per_unit REAL DEFAULT 0.0,
                        total_cost REAL DEFAULT 0.0,
                        supplier TEXT DEFAULT 'องค์การเภสัชกรรม (GPO)',
                        expiry_date TEXT,
                        received_by TEXT DEFAULT 'เภสัชกร/เจ้าหน้าที่',
                        notes TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (drug_id) REFERENCES drugs (id) ON DELETE SET NULL
                    )
                """)
                conn.execute("INSERT INTO stock_in_logs_migrated SELECT * FROM stock_in_logs")
                conn.execute("DROP TABLE stock_in_logs")
                conn.execute("ALTER TABLE stock_in_logs_migrated RENAME TO stock_in_logs")
                conn.execute("PRAGMA foreign_keys = ON")
        except Exception:
            pass

        # Indexes for fast search
        conn.execute("CREATE INDEX IF NOT EXISTS idx_drugs_name ON drugs(name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_drugs_code ON drugs(code)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_created ON dispensing_logs(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_batch_id ON dispensing_logs(batch_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_subscribers_target ON line_subscribers(target_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_stock_in_created ON stock_in_logs(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_stock_in_drug ON stock_in_logs(drug_id)")

        # Table: Authenticated Users (Google OAuth login)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT DEFAULT '',
                picture_url TEXT DEFAULT '',
                google_sub TEXT DEFAULT '',
                last_login TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TEXT
            )
        """)

        # Table: Audit Logs (who did what)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email TEXT NOT NULL,
                user_name TEXT DEFAULT '',
                action TEXT NOT NULL,
                target_type TEXT DEFAULT '',
                target_id TEXT DEFAULT '',
                target_name TEXT DEFAULT '',
                detail TEXT DEFAULT '',
                ip_address TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )
        """)

        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_email ON audit_logs(user_email)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)")

        # Auto-seed initial drugs if database is newly initialized
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM drugs")
        count = cursor.fetchone()[0]
        if count == 0:
            seed_file = Path(__file__).parent / "seed_drugs.json"
            if seed_file.exists():
                try:
                    with open(seed_file, "r", encoding="utf-8") as sf:
                        seed_data = json.load(sf)
                        now_str = get_now_str()
                        for item in seed_data:
                            cursor.execute("""
                                INSERT OR IGNORE INTO drugs (
                                    code, name, generic_name, category, dosage_form, strength,
                                    stock_qty, unit, min_threshold, price, cost, expiry_date,
                                    lot_number, location, image_url, qr_payload, instructions, created_at, updated_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)
                            """, (
                                item.get("code"),
                                item.get("name"),
                                item.get("generic_name", ""),
                                item.get("category", "ทั่วไป"),
                                item.get("dosage_form", "เม็ด (Tablet)"),
                                item.get("strength", ""),
                                int(item.get("stock_qty") or 0),
                                item.get("unit", "เม็ด"),
                                int(item.get("min_threshold") or 10),
                                float(item.get("price") or 0.0),
                                float(item.get("cost") or 0.0),
                                item.get("expiry_date", ""),
                                item.get("lot_number", ""),
                                item.get("location", "ตู้เก็บยาหลัก"),
                                item.get("qr_payload") or f"PHARM:{item.get('code')}",
                                item.get("instructions", ""),
                                now_str,
                                now_str
                            ))
                except Exception as e:
                    print(f"Error seeding drugs: {e}")
    conn.close()

# ─────────────────────────────────────────────────────────────
# Settings Management
# ─────────────────────────────────────────────────────────────

def get_setting(key, default=None):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else default

# ─────────────────────────────────────────────────────────────
# User Authentication & Audit Log
# ─────────────────────────────────────────────────────────────

def add_or_update_user(email: str, name: str = '', picture_url: str = '', google_sub: str = '') -> dict:
    """Upsert a Google-authenticated user. Returns the user dict."""
    conn = get_db()
    now = get_now_str()
    with conn:
        conn.execute("""
            INSERT INTO users (email, name, picture_url, google_sub, last_login, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
                name = excluded.name,
                picture_url = excluded.picture_url,
                google_sub = excluded.google_sub,
                last_login = excluded.last_login
        """, (email, name, picture_url, google_sub, now, now))
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else {"email": email, "name": name, "picture_url": picture_url}


def get_user_by_email(email: str) -> dict | None:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ? AND is_active = 1", (email,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def log_audit_action(user_email: str, user_name: str, action: str,
                     target_type: str = '', target_id: str = '',
                     target_name: str = '', detail: str = '', ip_address: str = ''):
    """Write one audit log row. Non-blocking — errors are silently ignored."""
    try:
        conn = get_db()
        with conn:
            conn.execute("""
                INSERT INTO audit_logs
                    (user_email, user_name, action, target_type, target_id, target_name, detail, ip_address, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (user_email, user_name, action, target_type,
                   str(target_id), target_name, detail, ip_address, get_now_str()))
        conn.close()
    except Exception:
        pass


def get_audit_logs(limit: int = 200, user_email: str = None,
                   action: str = None, date_filter: str = None) -> list:
    conn = get_db()
    cursor = conn.cursor()
    wheres, params = [], []
    if user_email:
        wheres.append("user_email = ?")
        params.append(user_email)
    if action:
        wheres.append("action = ?")
        params.append(action)
    if date_filter:
        wheres.append("DATE(created_at) = ?")
        params.append(date_filter)
    sql = "SELECT * FROM audit_logs"
    if wheres:
        sql += " WHERE " + " AND ".join(wheres)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    cursor.execute(sql, params)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_all_users() -> list:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, name, picture_url, last_login, is_active, created_at FROM users ORDER BY last_login DESC")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def set_setting(key, value):
    conn = get_db()
    now = get_now_str()
    with conn:
        conn.execute("""
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """, (key, str(value), now))
    conn.close()

def get_all_settings():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    conn.close()
    return {row[0]: row[1] for row in rows}

# ─────────────────────────────────────────────────────────────
# LINE Subscribers Management
# ─────────────────────────────────────────────────────────────

def add_or_update_line_subscriber(target_id, target_type='user', display_name=''):
    """Record or update a LINE user or group that interacts with the bot."""
    if not target_id or str(target_id).strip() in ('', 'unknown', 'None'):
        return False
    target_id = str(target_id).strip()
    target_type = str(target_type or 'user').strip()
    display_name = str(display_name or '').strip()
    now = get_now_str()

    conn = get_db()
    with conn:
        conn.execute("""
            INSERT INTO line_subscribers (target_id, target_type, display_name, is_active, created_at, last_active)
            VALUES (?, ?, ?, 1, ?, ?)
            ON CONFLICT(target_id) DO UPDATE SET
                target_type = excluded.target_type,
                display_name = CASE WHEN excluded.display_name != '' THEN excluded.display_name ELSE line_subscribers.display_name END,
                is_active = 1,
                last_active = excluded.last_active
        """, (target_id, target_type, display_name, now, now))
    conn.close()
    return True

def get_line_subscribers():
    """Get all active LINE notification subscribers."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM line_subscribers WHERE is_active = 1 ORDER BY last_active DESC")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

def remove_line_subscriber(target_id):
    """Deactivate or delete a LINE subscriber."""
    conn = get_db()
    with conn:
        conn.execute("UPDATE line_subscribers SET is_active = 0 WHERE target_id = ?", (target_id,))
    conn.close()
    return True

def is_line_subscriber_staff(target_id):
    """Check if a LINE user has been verified with staff privileges."""
    if not target_id or str(target_id).strip() in ('', 'unknown', 'None'):
        return False
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT is_staff FROM line_subscribers WHERE target_id = ?", (str(target_id).strip(),))
    row = cursor.fetchone()
    conn.close()
    return bool(row and row[0])

def set_line_subscriber_staff(target_id, is_staff=1):
    """Grant or revoke staff dispensing privileges for a LINE user."""
    if not target_id:
        return False
    conn = get_db()
    with conn:
        conn.execute("UPDATE line_subscribers SET is_staff = ? WHERE target_id = ?", (int(is_staff), str(target_id).strip()))
    conn.close()
    return True

# ─────────────────────────────────────────────────────────────
# Drug Expiry & Inventory Query Operations
# ─────────────────────────────────────────────────────────────

def parse_expiry_date(date_str):
    """Parse expiry date string into datetime.date object. Handles Buddhist Era (พ.ศ.) automatically."""
    if not date_str:
        return None
    cleaned = str(date_str).strip()
    if not cleaned:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            d = datetime.strptime(cleaned, fmt).date()
            if d.year > 2400:  # Thai Buddhist Era year (พ.ศ. 2560+ -> 2017+)
                d = d.replace(year=d.year - 543)
            return d
        except ValueError:
            pass
    return None

def get_expiring_drugs(days=60):
    """
    Get all drugs expiring within specified days (or already expired).
    Returns list sorted by days_left ascending (most urgent first).
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM drugs WHERE expiry_date IS NOT NULL AND TRIM(expiry_date) != ''")
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()

    today = datetime.now(BANGKOK_TZ).date()
    expiring = []
    for d in rows:
        exp_date = parse_expiry_date(d.get("expiry_date"))
        if not exp_date:
            continue
        days_left = (exp_date - today).days
        if days_left <= days:
            d_copy = dict(d)
            d_copy["days_left"] = days_left
            d_copy["is_expired"] = days_left < 0
            if days_left < 0:
                d_copy["urgency"] = "expired"
                d_copy["urgency_text"] = f"หมดอายุแล้ว ({abs(days_left)} วัน)"
                d_copy["status_color"] = "#EF4444"
            elif days_left <= 30:
                d_copy["urgency"] = "critical"
                d_copy["urgency_text"] = f"วิกฤต (เหลือ {days_left} วัน)"
                d_copy["status_color"] = "#F43F5E"
            else:
                d_copy["urgency"] = "warning"
                d_copy["urgency_text"] = f"ใกล้หมดอายุ (เหลือ {days_left} วัน)"
                d_copy["status_color"] = "#F59E0B"
            expiring.append(d_copy)

    # Sort by days_left ascending
    expiring.sort(key=lambda x: x["days_left"])
    return expiring

def get_all_drugs(search_query=None, category=None, low_stock_only=False, expiring_soon_days=None):
    """Fetch drugs with optional search and expiration filters."""
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM drugs WHERE 1=1"
    params = []

    if search_query:
        raw_q = search_query.strip().lower()
        alias_q = THAI_DRUG_ALIASES.get(raw_q, raw_q)
        query += " AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR LOWER(generic_name) LIKE ?"
        params.extend([f"%{raw_q}%", f"%{raw_q}%", f"%{raw_q}%"])
        if alias_q != raw_q:
            query += " OR LOWER(name) LIKE ? OR LOWER(generic_name) LIKE ?"
            params.extend([f"%{alias_q}%", f"%{alias_q}%"])
        query += ")"

    if category and category != "all":
        query += " AND category = ?"
        params.append(category)

    if low_stock_only:
        query += " AND stock_qty <= min_threshold"

    query += " ORDER BY name ASC"
    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()

    # Calculate days_left and urgency for each drug
    today = datetime.now(BANGKOK_TZ).date()
    processed = []
    for d in rows:
        exp_date = parse_expiry_date(d.get("expiry_date"))
        if exp_date:
            days_left = (exp_date - today).days
            d["days_left"] = days_left
            d["is_expired"] = days_left < 0
            d["is_expiring_soon"] = days_left <= 60
            if days_left < 0:
                d["urgency"] = "expired"
                d["urgency_text"] = f"หมดอายุแล้ว ({abs(days_left)} วัน)"
            elif days_left <= 30:
                d["urgency"] = "critical"
                d["urgency_text"] = f"ด่วนมาก ({days_left} วัน)"
            elif days_left <= 60:
                d["urgency"] = "warning"
                d["urgency_text"] = f"ใกล้หมด ({days_left} วัน)"
            else:
                d["urgency"] = "normal"
                d["urgency_text"] = f"ปกติ ({days_left} วัน)"
        else:
            d["days_left"] = None
            d["is_expired"] = False
            d["is_expiring_soon"] = False
            d["urgency"] = "unknown"
            d["urgency_text"] = "-"

        if expiring_soon_days is not None:
            max_days = int(expiring_soon_days)
            if d["days_left"] is None or d["days_left"] > max_days:
                continue

        processed.append(d)

    return processed

def get_drug_by_id(drug_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM drugs WHERE id = ?", (drug_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_drug_by_code(code):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM drugs WHERE UPPER(code) = UPPER(?)", (code.strip(),))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

# Common Thai medical aliases & abbreviations mapping
THAI_DRUG_ALIASES = {
    "พารา": "paracetamol",
    "พาราเซตามอล": "paracetamol",
    "พาราเซต": "paracetamol",
    "อะม็อกซี่": "amoxicillin",
    "อาม็อกซี่": "amoxicillin",
    "แอมม็อก": "amoxicillin",
    "ไอบู": "ibuprofen",
    "ไอบูโพรเฟน": "ibuprofen",
    "โอมีพราโซล": "omeprazole",
    "ยาลดกรด": "antacid",
    "แอนตาซิล": "antacid",
    "เซทิริซีน": "cetirizine",
    "เซทริซีน": "cetirizine",
    "แนค": "nac",
    "แนคลอง": "nac",
    "วิตซี": "vitamin c",
    "วิตามินซี": "vitamin c",
    "อ็อกเมนติน": "augmentin",
    "ออคเมนติน": "augmentin",
    "น้ำเกลือ": "saline",
}

def find_drug_by_name_or_alias(query_str):
    """
    Find best matching drug by name, code, or alias (case-insensitive & fuzzy substring).
    Useful for LINE text commands like 'พารา 2' or 'Amox 1'.
    """
    if not query_str:
        return None
    raw_q = query_str.strip().lower()
    
    # Check Thai alias mapping
    q = THAI_DRUG_ALIASES.get(raw_q, raw_q)
    
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Exact match on code, name, or generic_name
    cursor.execute("SELECT * FROM drugs WHERE LOWER(code) = ? OR LOWER(name) = ? OR LOWER(generic_name) = ?", (q, q, q))
    row = cursor.fetchone()
    if row:
        conn.close()
        return dict(row)

    # 2. Starts with query
    cursor.execute("SELECT * FROM drugs WHERE LOWER(name) LIKE ? OR LOWER(generic_name) LIKE ?", (f"{q}%", f"{q}%"))
    row = cursor.fetchone()
    if row:
        conn.close()
        return dict(row)

    # 3. Substring match (name, generic_name, or code only - avoid instructions/warnings)
    cursor.execute("SELECT * FROM drugs WHERE LOWER(name) LIKE ? OR LOWER(generic_name) LIKE ? OR LOWER(code) LIKE ?", (f"%{q}%", f"%{q}%", f"%{q}%"))
    rows = cursor.fetchall()
    conn.close()
    
    if rows:
        # Return shortest matching name (most relevant)
        sorted_rows = sorted(rows, key=lambda r: len(r["name"]))
        return dict(sorted_rows[0])
    
    return None

def add_drug(data):
    """Insert a new drug into inventory."""
    conn = get_db()
    now = get_now_str()
    code = (data.get("code") or "").strip()
    if not code:
        # Generate automatic code
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM drugs")
        count = cursor.fetchone()[0] + 1
        code = f"MED-{count:04d}"

    qr_payload = data.get("qr_payload") or f"PHARM:{code}"

    with conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO drugs (
                code, name, generic_name, category, dosage_form, strength,
                stock_qty, unit, min_threshold, price, cost, expiry_date,
                lot_number, location, image_url, qr_payload, instructions, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            code,
            data.get("name", "").strip(),
            data.get("generic_name", "").strip(),
            data.get("category", "ทั่วไป"),
            data.get("dosage_form", "เม็ด (Tablet)"),
            data.get("strength", "").strip(),
            int(data.get("stock_qty") or 0),
            data.get("unit", "เม็ด").strip(),
            int(data.get("min_threshold") or 10),
            float(data.get("price") or 0.0),
            float(data.get("cost") or 0.0),
            data.get("expiry_date", ""),
            data.get("lot_number", "").strip(),
            data.get("location", "ตู้เก็บยาหลัก"),
            data.get("image_url", "").strip(),
            qr_payload,
            data.get("instructions", ""),
            now,
            now
        ))
        drug_id = cursor.lastrowid
    conn.close()
    return get_drug_by_id(drug_id)

def update_drug(drug_id, data):
    """Update existing drug details."""
    conn = get_db()
    now = get_now_str()
    with conn:
        conn.execute("""
            UPDATE drugs SET
                name = COALESCE(?, name),
                generic_name = COALESCE(?, generic_name),
                category = COALESCE(?, category),
                dosage_form = COALESCE(?, dosage_form),
                strength = COALESCE(?, strength),
                stock_qty = COALESCE(?, stock_qty),
                unit = COALESCE(?, unit),
                min_threshold = COALESCE(?, min_threshold),
                price = COALESCE(?, price),
                cost = COALESCE(?, cost),
                expiry_date = COALESCE(?, expiry_date),
                lot_number = COALESCE(?, lot_number),
                location = COALESCE(?, location),
                image_url = COALESCE(?, image_url),
                instructions = COALESCE(?, instructions),
                updated_at = ?
            WHERE id = ?
        """, (
            data.get("name"),
            data.get("generic_name"),
            data.get("category"),
            data.get("dosage_form"),
            data.get("strength"),
            data.get("stock_qty"),
            data.get("unit"),
            data.get("min_threshold"),
            data.get("price"),
            data.get("cost"),
            data.get("expiry_date"),
            data.get("lot_number"),
            data.get("location"),
            data.get("image_url"),
            data.get("instructions"),
            now,
            drug_id
        ))
    conn.close()
    return get_drug_by_id(drug_id)

def delete_drug(drug_id):
    """Delete drug from inventory while strictly preserving all audit history in dispensing_logs and stock_in_logs."""
    conn = get_db()
    with _db_write_lock:
        with conn:
            conn.execute("UPDATE stock_in_logs SET drug_id = NULL WHERE drug_id = ?", (drug_id,))
            conn.execute("UPDATE dispensing_logs SET drug_id = NULL WHERE drug_id = ?", (drug_id,))
            conn.execute("DELETE FROM drugs WHERE id = ?", (drug_id,))
    conn.close()
    return True

# ─────────────────────────────────────────────────────────────
# Stock Dispensing & Deduction Flow (Atomic Transaction)
# ─────────────────────────────────────────────────────────────

def deduct_stock(drug_id_or_code, quantity, channel="WEB_MANUAL", dispensed_by="เจ้าหน้าที่", patient_name="", drive_file_id=None, drive_file_link=None, notes=""):
    """
    Atomically deduct stock from a drug and insert a dispensing log.
    Thread-safe and race-condition protected.
    Returns: (success: bool, result_dict or error_message)
    """
    try:
        qty_int = int(quantity)
    except (ValueError, TypeError):
        return False, "จำนวนที่ตัดต้องเป็นตัวเลขจำนวนเต็มบวก"

    if qty_int <= 0:
        return False, "จำนวนที่ตัดต้องมากกว่า 0"

    with _db_write_lock:
        conn = get_db()
        cursor = conn.cursor()
        now = get_now_str()

        try:
            with conn:
                # 1. Fetch drug details
                if isinstance(drug_id_or_code, int) or (isinstance(drug_id_or_code, str) and str(drug_id_or_code).isdigit()):
                    cursor.execute("SELECT * FROM drugs WHERE id = ?", (int(drug_id_or_code),))
                else:
                    cursor.execute("SELECT * FROM drugs WHERE UPPER(code) = UPPER(?) OR LOWER(name) = LOWER(?)", (str(drug_id_or_code).strip(), str(drug_id_or_code).strip()))

                row = cursor.fetchone()
                if not row:
                    return False, f"ไม่พบข้อมูลยา: {drug_id_or_code}"

                drug = dict(row)
                drug_id = drug["id"]

                # 2. Atomic decrement with SQLite RETURNING
                cursor.execute("""
                    UPDATE drugs 
                    SET stock_qty = stock_qty - ?, updated_at = ? 
                    WHERE id = ? AND stock_qty >= ?
                    RETURNING stock_qty, (stock_qty + ?) AS balance_before
                """, (qty_int, now, drug_id, qty_int, qty_int))

                update_row = cursor.fetchone()
                if not update_row:
                    cursor.execute("SELECT stock_qty FROM drugs WHERE id = ?", (drug_id,))
                    cur_row = cursor.fetchone()
                    cur_stock = cur_row[0] if cur_row else 0
                    return False, f"สต็อกไม่เพียงพอ! มียา '{drug['name']}' เหลืออยู่เพียง {cur_stock} {drug['unit']} (ต้องการตัด {qty_int} {drug['unit']})"

                new_stock = update_row[0]
                current_stock = update_row[1]

                # 3. Insert dispensing log
                cursor.execute("""
                    INSERT INTO dispensing_logs (
                        drug_id, drug_code, drug_name, quantity,
                        balance_before, balance_after, channel,
                        dispensed_by, patient_name, drive_file_id,
                        drive_file_link, notes, synced_to_sheet, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """, (
                    drug["id"],
                    drug["code"],
                    drug["name"],
                    qty_int,
                    current_stock,
                    new_stock,
                    channel,
                    dispensed_by,
                    patient_name,
                    drive_file_id,
                    drive_file_link,
                    notes,
                    now
                ))
                log_id = cursor.lastrowid

                drug_price = float(drug.get("price") or 0.0)
                drug_cost = float(drug.get("cost") or 0.0)
                dispensed_total_price = qty_int * drug_price

                result = {
                    "log_id": log_id,
                    "drug_id": drug["id"],
                    "drug_code": drug["code"],
                    "drug_name": drug["name"],
                    "quantity": qty_int,
                    "unit": drug["unit"],
                    "price": drug_price,
                    "cost": drug_cost,
                    "total_price": dispensed_total_price,
                    "total_price_formatted": f"฿{dispensed_total_price:,.2f}",
                    "balance_before": current_stock,
                    "balance_after": new_stock,
                    "min_threshold": drug["min_threshold"],
                    "is_low_stock": new_stock <= drug["min_threshold"],
                    "channel": channel,
                    "dispensed_by": dispensed_by,
                    "patient_name": patient_name,
                    "notes": notes,
                    "location": drug.get("location", "-"),
                    "category": drug.get("category", "-"),
                    "image_url": drug.get("image_url", ""),
                    "created_at": now,
                    "drive_file_link": drive_file_link
                }
                return True, result
        except Exception as e:
            return False, f"เกิดข้อผิดพลาดในการตัดสต็อก: {str(e)}"
        finally:
            conn.close()


def deduct_stock_batch(items, channel="WEB_RX_CART", dispensed_by="เจ้าหน้าที่", patient_name="", requester_dept="", notes=""):
    """
    Atomically deduct stock for multiple drugs in a single prescription / requisition batch.
    items: list of dicts: [{"drug_id": int/str, "quantity": int, "notes": str (optional)}]
    If ANY drug has insufficient stock or is invalid, the entire transaction rolls back cleanly.
    Returns: (success: bool, result_dict or error_message)
    """
    if not items or not isinstance(items, list):
        return False, "ไม่มีรายการยาในใบสั่งยา (กรุณาเลือกยาอย่างน้อย 1 รายการ)"

    # Validate each item structure & positive quantities
    cleaned_items = []
    demand_by_drug = {}

    for idx, item in enumerate(items, start=1):
        drug_ref = item.get("drug_id") or item.get("code") or item.get("drug_code")
        if not drug_ref:
            return False, f"รายการที่ {idx}: ไม่ได้ระบุรหัสยา"
        try:
            qty_int = int(item.get("quantity", 0))
        except (ValueError, TypeError):
            return False, f"รายการที่ {idx}: จำนวนที่ตัดต้องเป็นตัวเลขจำนวนเต็มบวก"
        if qty_int <= 0:
            return False, f"รายการที่ {idx}: จำนวนที่ตัดต้องมากกว่า 0"

        demand_by_drug[str(drug_ref)] = demand_by_drug.get(str(drug_ref), 0) + qty_int
        cleaned_items.append({
            "drug_ref": drug_ref,
            "quantity": qty_int,
            "notes": str(item.get("notes") or "").strip()
        })

    with _db_write_lock:
        conn = get_db()
        cursor = conn.cursor()
        now = get_now_str()
        batch_id = f"RX-{datetime.now(BANGKOK_TZ).strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(2).upper()}"

        try:
            with conn:
                # 1. Pre-validate all drugs and total available stock
                resolved_drugs = {}
                for drug_ref, total_needed in demand_by_drug.items():
                    if str(drug_ref).isdigit():
                        cursor.execute("SELECT * FROM drugs WHERE id = ?", (int(drug_ref),))
                    else:
                        cursor.execute("SELECT * FROM drugs WHERE UPPER(code) = UPPER(?) OR LOWER(name) = LOWER(?)", (str(drug_ref).strip(), str(drug_ref).strip()))
                    row = cursor.fetchone()
                    if not row:
                        return False, f"ไม่พบข้อมูลยาในระบบ: {drug_ref}"
                    drug_dict = dict(row)
                    cur_stock = int(drug_dict.get("stock_qty") or 0)
                    if cur_stock < total_needed:
                        return False, f"สต็อกไม่เพียงพอ! ยา '{drug_dict['name']}' ในคลังมี {cur_stock} {drug_dict['unit']} (ใบสั่งยานี้ต้องการรวม {total_needed} {drug_dict['unit']})"
                    resolved_drugs[str(drug_ref)] = drug_dict

                # 2. Perform atomic deductions & insert dispensing logs
                dispensed_results = []
                total_batch_price = 0.0
                total_batch_qty = 0

                for it in cleaned_items:
                    drug_dict = resolved_drugs[str(it["drug_ref"])]
                    d_id = drug_dict["id"]
                    q = it["quantity"]
                    item_note = it["notes"] or notes

                    cursor.execute("""
                        UPDATE drugs
                        SET stock_qty = stock_qty - ?, updated_at = ?
                        WHERE id = ? AND stock_qty >= ?
                        RETURNING stock_qty, (stock_qty + ?) AS balance_before
                    """, (q, now, d_id, q, q))

                    update_row = cursor.fetchone()
                    if not update_row:
                        return False, f"เกิดข้อผิดพลาดในการตัดสต็อกยา '{drug_dict['name']}' (สต็อกอาจถูกตัดจากจุดอื่นก่อนหน้า)"

                    new_stock = update_row[0]
                    current_stock = update_row[1]

                    cursor.execute("""
                        INSERT INTO dispensing_logs (
                            drug_id, drug_code, drug_name, quantity,
                            balance_before, balance_after, channel,
                            dispensed_by, patient_name, drive_file_id,
                            drive_file_link, notes, synced_to_sheet, created_at, batch_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?)
                    """, (
                        d_id,
                        drug_dict["code"],
                        drug_dict["name"],
                        q,
                        current_stock,
                        new_stock,
                        channel,
                        dispensed_by,
                        patient_name,
                        item_note,
                        now,
                        batch_id
                    ))
                    log_id = cursor.lastrowid

                    d_price = float(drug_dict.get("price") or 0.0)
                    d_cost = float(drug_dict.get("cost") or 0.0)
                    subtotal = q * d_price
                    total_batch_price += subtotal
                    total_batch_qty += q

                    dispensed_results.append({
                        "log_id": log_id,
                        "drug_id": d_id,
                        "drug_code": drug_dict["code"],
                        "drug_name": drug_dict["name"],
                        "generic_name": drug_dict.get("generic_name", ""),
                        "category": drug_dict.get("category", "ทั่วไป"),
                        "quantity": q,
                        "unit": drug_dict["unit"],
                        "price": d_price,
                        "cost": d_cost,
                        "subtotal": subtotal,
                        "subtotal_formatted": f"฿{subtotal:,.2f}",
                        "balance_before": current_stock,
                        "balance_after": new_stock,
                        "is_low_stock": new_stock <= drug_dict.get("min_threshold", 10),
                        "notes": item_note,
                        "batch_id": batch_id,
                        "created_at": now
                    })

                summary = {
                    "batch_id": batch_id,
                    "total_items": len(dispensed_results),
                    "total_qty": total_batch_qty,
                    "total_price": total_batch_price,
                    "total_price_formatted": f"฿{total_batch_price:,.2f}",
                    "patient_name": patient_name,
                    "requester_dept": requester_dept,
                    "dispensed_by": dispensed_by,
                    "notes": notes,
                    "items": dispensed_results,
                    "log_ids": [r["log_id"] for r in dispensed_results],
                    "created_at": now,
                    "requisition_url": f"/api/dispense/requisition/batch/{batch_id}"
                }
                return True, summary
        except Exception as e:
            return False, f"เกิดข้อผิดพลาดในการตัดสต็อกแบบกลุ่ม: {str(e)}"
        finally:
            conn.close()


def get_dispensing_logs_by_batch(batch_id):
    """Retrieve all dispensing logs associated with a single prescription batch_id."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            dispensing_logs.*,
            COALESCE(drugs.image_url, '') AS image_url,
            COALESCE(drugs.unit, 'หน่วย') AS unit,
            COALESCE(drugs.category, '-') AS category,
            COALESCE(drugs.generic_name, '') AS generic_name,
            COALESCE(drugs.price, 0.0) AS price,
            COALESCE(drugs.cost, 0.0) AS cost,
            COALESCE(drugs.instructions, '') AS instructions
        FROM dispensing_logs
        LEFT JOIN drugs ON dispensing_logs.drug_id = drugs.id
        WHERE dispensing_logs.batch_id = ?
        ORDER BY dispensing_logs.id ASC
    """, (str(batch_id).strip(),))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows

# ─────────────────────────────────────────────────────────────
# Dispensing Logs & Analytics
# ─────────────────────────────────────────────────────────────

def get_dispensing_logs(limit=100, drug_id=None, date_filter=None, channel_filter=None, start_date=None, end_date=None):
    """Retrieve dispensing history with filters and drug image/details."""
    conn = get_db()
    cursor = conn.cursor()
    query = """
        SELECT 
            dispensing_logs.*,
            COALESCE(drugs.image_url, '') AS image_url,
            COALESCE(drugs.unit, 'หน่วย') AS unit,
            COALESCE(drugs.category, '-') AS category,
            COALESCE(drugs.generic_name, '') AS generic_name,
            COALESCE(drugs.price, 0) AS price,
            COALESCE(drugs.cost, 0) AS cost
        FROM dispensing_logs
        LEFT JOIN drugs ON dispensing_logs.drug_id = drugs.id
        WHERE 1=1
    """
    params = []

    if drug_id:
        query += " AND dispensing_logs.drug_id = ?"
        params.append(drug_id)

    if start_date and end_date:
        query += " AND dispensing_logs.created_at >= ? AND dispensing_logs.created_at <= ?"
        params.append(f"{start_date} 00:00:00")
        params.append(f"{end_date} 23:59:59")
    elif start_date:
        query += " AND dispensing_logs.created_at >= ?"
        params.append(f"{start_date} 00:00:00")
    elif end_date:
        query += " AND dispensing_logs.created_at <= ?"
        params.append(f"{end_date} 23:59:59")
    elif date_filter:
        query += " AND dispensing_logs.created_at LIKE ?"
        params.append(f"{date_filter}%")

    if channel_filter and channel_filter != "all":
        cf = str(channel_filter).strip().upper()
        if cf in ("QR", "QR_SCAN", "SCANNER", "BARCODE", "BARCODE_SCAN"):
            query += " AND (UPPER(dispensing_logs.channel) LIKE '%QR%' OR UPPER(dispensing_logs.channel) LIKE '%SCAN%' OR UPPER(dispensing_logs.channel) LIKE '%BARCODE%')"
        elif cf in ("LINE", "LINE_BOT", "LINE_TEXT", "LINE_OCR"):
            query += " AND UPPER(dispensing_logs.channel) LIKE 'LINE%'"
        elif cf == "WEB":
            query += " AND UPPER(dispensing_logs.channel) LIKE 'WEB%'"
        elif cf == "WEB_MANUAL":
            query += " AND UPPER(dispensing_logs.channel) = 'WEB_MANUAL'"
        elif cf == "WEB_RX_CART":
            query += " AND UPPER(dispensing_logs.channel) = 'WEB_RX_CART'"
        else:
            query += " AND UPPER(dispensing_logs.channel) = ?"
            params.append(cf)

    query += " ORDER BY dispensing_logs.id DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

def get_dispensing_log_by_id(log_id):
    """Retrieve a single dispensing log with full drug details by its ID."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            dispensing_logs.*,
            COALESCE(drugs.image_url, '') AS image_url,
            COALESCE(drugs.unit, 'หน่วย') AS unit,
            COALESCE(drugs.category, '-') AS category,
            COALESCE(drugs.generic_name, '') AS generic_name,
            COALESCE(drugs.location, 'ตู้ยาคลินิก') AS location,
            COALESCE(drugs.price, 0) AS price
        FROM dispensing_logs
        LEFT JOIN drugs ON dispensing_logs.drug_id = drugs.id
        WHERE dispensing_logs.id = ?
    """, (log_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def void_dispensing_log(log_id, reason="ยกเลิกรายการจ่าย", voided_by="เจ้าหน้าที่"):
    """
    Atomically cancel/void a dispensing log, restore drug stock, and mark the log as voided.
    Returns: (success: bool, result_dict or error_message)
    """
    with _db_write_lock:
        conn = get_db()
        cursor = conn.cursor()
        now = get_now_str()

        try:
            with conn:
                cursor.execute("SELECT * FROM dispensing_logs WHERE id = ?", (log_id,))
                row = cursor.fetchone()
                if not row:
                    return False, f"ไม่พบรายการจ่ายยา ID #{log_id}"

                log = dict(row)
                if log.get("is_voided"):
                    return False, f"รายการจ่ายยา ID #{log_id} ถูกยกเลิกไปแล้วเมื่อ {log.get('voided_at')}"

                drug_id = log.get("drug_id")
                qty = log.get("quantity") or 0

                # 1. Restore stock to drug if drug still exists
                new_stock = None
                if drug_id:
                    cursor.execute("""
                        UPDATE drugs 
                        SET stock_qty = stock_qty + ?, updated_at = ?
                        WHERE id = ?
                        RETURNING stock_qty
                    """, (qty, now, drug_id))
                    drug_res = cursor.fetchone()
                    if drug_res:
                        new_stock = drug_res[0]

                # 2. Mark log as voided
                cursor.execute("""
                    UPDATE dispensing_logs 
                    SET is_voided = 1, void_reason = ?, voided_by = ?, voided_at = ?
                    WHERE id = ?
                """, (reason.strip(), voided_by.strip(), now, log_id))

                return True, {
                    "log_id": log_id,
                    "drug_id": drug_id,
                    "drug_name": log.get("drug_name"),
                    "quantity_restored": qty,
                    "new_stock": new_stock,
                    "voided_by": voided_by,
                    "void_reason": reason,
                    "voided_at": now
                }
        except Exception as e:
            return False, f"เกิดข้อผิดพลาดในการยกเลิกรายการจ่าย: {str(e)}"
        finally:
            conn.close()

def mark_dispensing_log_synced(log_id):
    """Mark a dispensing log as successfully synced to Google Sheets."""
    try:
        conn = get_db()
        with conn:
            conn.execute("UPDATE dispensing_logs SET synced_to_sheet = 1 WHERE id = ?", (log_id,))
        conn.close()
        return True
    except Exception:
        return False

def get_dashboard_stats():
    """Summary metrics for the clinical dashboard including monetary valuations."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            COUNT(*) as total_drugs,
            COALESCE(SUM(stock_qty), 0) as total_units,
            COALESCE(SUM(stock_qty * COALESCE(price, 0)), 0.0) as total_inventory_value,
            COALESCE(SUM(stock_qty * COALESCE(cost, 0)), 0.0) as total_inventory_cost
        FROM drugs
    """)
    val_row = cursor.fetchone()
    total_drugs = val_row["total_drugs"] or 0
    total_units = val_row["total_units"] or 0
    total_inventory_value = round(val_row["total_inventory_value"] or 0.0, 2)
    total_inventory_cost = round(val_row["total_inventory_cost"] or 0.0, 2)

    cursor.execute("SELECT COUNT(*) FROM drugs WHERE stock_qty <= min_threshold")
    low_stock_count = cursor.fetchone()[0]

    # Today's dispensing count, units & total value
    today_str = datetime.now(BANGKOK_TZ).strftime("%Y-%m-%d")
    cursor.execute("""
        SELECT 
            COUNT(*), 
            COALESCE(SUM(dispensing_logs.quantity), 0),
            COALESCE(SUM(dispensing_logs.quantity * COALESCE(drugs.price, 0)), 0.0)
        FROM dispensing_logs
        LEFT JOIN drugs ON dispensing_logs.drug_id = drugs.id
        WHERE dispensing_logs.created_at LIKE ? AND (dispensing_logs.is_voided IS NULL OR dispensing_logs.is_voided = 0)
    """, (f"{today_str}%",))
    disp_count_row = cursor.fetchone()
    today_dispense_count = disp_count_row[0] or 0
    today_units_dispensed = disp_count_row[1] or 0
    today_dispensed_value = round(disp_count_row[2] or 0.0, 2)

    conn.close()

    # Expiring soon (within 60 days or already expired)
    expiring_drugs = get_expiring_drugs(days=60)
    expiring_soon_count = len(expiring_drugs)

    return {
        "total_drugs": total_drugs,
        "total_units": total_units,
        "total_inventory_value": total_inventory_value,
        "total_inventory_value_formatted": f"฿{total_inventory_value:,.2f}",
        "total_inventory_cost": total_inventory_cost,
        "total_inventory_cost_formatted": f"฿{total_inventory_cost:,.2f}",
        "low_stock_count": low_stock_count,
        "today_dispense_count": today_dispense_count,
        "today_units_dispensed": today_units_dispensed,
        "today_dispensed_value": today_dispensed_value,
        "today_dispensed_value_formatted": f"฿{today_dispensed_value:,.2f}",
        "expiring_soon_count": expiring_soon_count,
        "expiring_items": expiring_drugs[:5]
    }

# ─────────────────────────────────────────────────────────────
# Stock In / Receiving & Lot Management Flow
# ─────────────────────────────────────────────────────────────

def stock_in(drug_id_or_code, quantity, lot_number="", cost_per_unit=None, expiry_date=None, supplier="องค์การเภสัชกรรม (GPO)", received_by="เภสัชกร/เจ้าหน้าที่", notes=""):
    """
    Atomically add received stock into inventory and record a Stock In log.
    Thread-safe and race-condition protected.
    Updates lot_number, expiry_date, cost, and stock_qty on the drug record.
    Returns: (success: bool, result_dict or error_message)
    """
    try:
        qty_int = int(quantity)
    except (ValueError, TypeError):
        return False, "จำนวนที่รับเข้าต้องเป็นตัวเลขจำนวนเต็มบวก"

    if qty_int <= 0:
        return False, "จำนวนที่รับเข้าต้องมากกว่า 0"

    with _db_write_lock:
        conn = get_db()
        cursor = conn.cursor()
        now = get_now_str()

        try:
            with conn:
                # 1. Fetch drug
                if isinstance(drug_id_or_code, int) or (isinstance(drug_id_or_code, str) and str(drug_id_or_code).isdigit()):
                    cursor.execute("SELECT * FROM drugs WHERE id = ?", (int(drug_id_or_code),))
                else:
                    cursor.execute("SELECT * FROM drugs WHERE UPPER(code) = UPPER(?) OR LOWER(name) = LOWER(?)", (str(drug_id_or_code).strip(), str(drug_id_or_code).strip()))

                row = cursor.fetchone()
                if not row:
                    return False, f"ไม่พบข้อมูลยา: {drug_id_or_code}"

                drug = dict(row)
                drug_id = drug["id"]

                # Determine cost: Keep actual batch invoice unit_cost in log,
                # but update drugs.cost with Moving Weighted Average Cost (WAC)
                try:
                    unit_cost = float(cost_per_unit) if cost_per_unit is not None and str(cost_per_unit).strip() != "" else float(drug.get("cost") or 0.0)
                except (ValueError, TypeError):
                    unit_cost = float(drug.get("cost") or 0.0)
                total_cost = round(unit_cost * qty_int, 2)

                current_stock = int(drug.get("stock_qty") or 0)
                current_cost = float(drug.get("cost") or 0.0)
                if current_stock > 0 and current_cost > 0:
                    weighted_unit_cost = round(((current_stock * current_cost) + (qty_int * unit_cost)) / (current_stock + qty_int), 2)
                else:
                    weighted_unit_cost = unit_cost

                # Determine expiry date (FEFO: keep earliest active expiry date for alert tracking)
                incoming_exp = expiry_date.strip() if expiry_date and str(expiry_date).strip() else (drug.get("expiry_date") or "")
                existing_exp = (drug.get("expiry_date") or "").strip()
                if existing_exp and incoming_exp and current_stock > 0:
                    p_existing = parse_expiry_date(existing_exp)
                    p_incoming = parse_expiry_date(incoming_exp)
                    if p_existing and p_incoming:
                        effective_expiry = existing_exp if p_existing <= p_incoming else incoming_exp
                    else:
                        effective_expiry = incoming_exp or existing_exp
                else:
                    effective_expiry = incoming_exp or existing_exp

                lot_no = lot_number.strip() if lot_number and str(lot_number).strip() else (drug.get("lot_number") or "")

                # 2. Atomic increment with SQLite RETURNING
                cursor.execute("""
                    UPDATE drugs SET 
                        stock_qty = stock_qty + ?,
                        cost = ?,
                        expiry_date = ?,
                        lot_number = ?,
                        updated_at = ?
                    WHERE id = ?
                    RETURNING stock_qty, (stock_qty - ?) AS balance_before
                """, (qty_int, weighted_unit_cost, effective_expiry, lot_no, now, drug_id, qty_int))

                row_update = cursor.fetchone()
                new_stock = row_update[0]
                current_stock = row_update[1]

                # 3. Insert stock_in_logs
                cursor.execute("""
                    INSERT INTO stock_in_logs (
                        drug_id, drug_code, drug_name, lot_number, quantity,
                        balance_before, balance_after, cost_per_unit, total_cost,
                        supplier, expiry_date, received_by, notes, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    drug["id"],
                    drug["code"],
                    drug["name"],
                    lot_no,
                    qty_int,
                    current_stock,
                    new_stock,
                    unit_cost,
                    total_cost,
                    supplier or "องค์การเภสัชกรรม (GPO)",
                    incoming_exp,
                    received_by or "เภสัชกร/เจ้าหน้าที่",
                    notes or "",
                    now
                ))
                log_id = cursor.lastrowid

                result = {
                    "log_id": log_id,
                    "drug_id": drug["id"],
                    "drug_code": drug["code"],
                    "drug_name": drug["name"],
                    "lot_number": lot_no,
                    "quantity": qty_int,
                    "unit": drug.get("unit", "หน่วย"),
                    "balance_before": current_stock,
                    "balance_after": new_stock,
                    "cost_per_unit": unit_cost,
                    "total_cost": total_cost,
                    "supplier": supplier,
                    "expiry_date": incoming_exp,
                    "effective_expiry": effective_expiry,
                    "received_by": received_by,
                    "image_url": drug.get("image_url", ""),
                    "notes": notes,
                    "created_at": now
                }
                return True, result
        except Exception as e:
            return False, f"เกิดข้อผิดพลาดในการรับยาเข้าคลัง: {str(e)}"
        finally:
            conn.close()

def get_stock_in_logs(limit=100, drug_id=None, date_filter=None, start_date=None, end_date=None):
    """Retrieve stock-in receiving logs with drug image/details."""
    conn = get_db()
    cursor = conn.cursor()
    query = """
        SELECT 
            stock_in_logs.*,
            COALESCE(drugs.image_url, '') AS image_url,
            COALESCE(drugs.unit, 'หน่วย') AS unit,
            COALESCE(drugs.category, '-') AS category,
            COALESCE(drugs.generic_name, '') AS generic_name
        FROM stock_in_logs
        LEFT JOIN drugs ON stock_in_logs.drug_id = drugs.id
        WHERE 1=1
    """
    params = []

    if drug_id:
        query += " AND stock_in_logs.drug_id = ?"
        params.append(drug_id)

    if start_date and end_date:
        query += " AND stock_in_logs.created_at >= ? AND stock_in_logs.created_at <= ?"
        params.append(f"{start_date} 00:00:00")
        params.append(f"{end_date} 23:59:59")
    elif start_date:
        query += " AND stock_in_logs.created_at >= ?"
        params.append(f"{start_date} 00:00:00")
    elif end_date:
        query += " AND stock_in_logs.created_at <= ?"
        params.append(f"{end_date} 23:59:59")
    elif date_filter:
        query += " AND stock_in_logs.created_at LIKE ?"
        params.append(f"{date_filter}%")

    query += " ORDER BY stock_in_logs.id DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

def get_analytics_summary():
    """Aggregate comprehensive analytics for clinical dashboard and visual charts."""
    conn = get_db()
    cursor = conn.cursor()

    # 1. Total Valuation & Inventory Totals
    cursor.execute("""
        SELECT 
            COUNT(*) as total_items,
            COALESCE(SUM(stock_qty), 0) as total_units,
            COALESCE(SUM(stock_qty * price), 0.0) as retail_valuation,
            COALESCE(SUM(stock_qty * cost), 0.0) as cost_valuation
        FROM drugs
    """)
    val_row = cursor.fetchone()
    total_items = val_row["total_items"] or 0
    total_units = val_row["total_units"] or 0
    retail_valuation = round(val_row["retail_valuation"] or 0.0, 2)
    cost_valuation = round(val_row["cost_valuation"] or 0.0, 2)
    potential_margin = round(retail_valuation - cost_valuation, 2)

    # 2. Category Distribution
    cursor.execute("""
        SELECT category, COUNT(*) as count, COALESCE(SUM(stock_qty), 0) as units, COALESCE(SUM(stock_qty * price), 0) as value
        FROM drugs
        GROUP BY category
        ORDER BY units DESC
    """)
    categories = [dict(r) for r in cursor.fetchall()]

    # 3. Top Dispensed Drugs
    cursor.execute("""
        SELECT drug_name, SUM(quantity) as total_qty, COUNT(*) as dispense_count
        FROM dispensing_logs
        WHERE (dispensing_logs.is_voided IS NULL OR dispensing_logs.is_voided = 0)
        GROUP BY drug_name
        ORDER BY total_qty DESC
        LIMIT 6
    """)
    top_dispensed = [dict(r) for r in cursor.fetchall()]

    # 4. 7-Day Trend: Dispensed vs Received
    today = datetime.now(BANGKOK_TZ).date()
    days_labels = []
    dispensed_series = []
    received_series = []

    for i in range(6, -1, -1):
        day_date = today - timedelta(days=i)
        day_str = day_date.strftime("%Y-%m-%d")
        day_display = day_date.strftime("%d/%m")
        days_labels.append(day_display)

        # Dispensed on day
        cursor.execute("SELECT COALESCE(SUM(quantity), 0) FROM dispensing_logs WHERE created_at LIKE ? AND (dispensing_logs.is_voided IS NULL OR dispensing_logs.is_voided = 0)", (f"{day_str}%",))
        disp_qty = cursor.fetchone()[0] or 0
        dispensed_series.append(disp_qty)

        # Received on day
        cursor.execute("SELECT COALESCE(SUM(quantity), 0) FROM stock_in_logs WHERE created_at LIKE ?", (f"{day_str}%",))
        rec_qty = cursor.fetchone()[0] or 0
        received_series.append(rec_qty)

    # 5. Expiry Risk Breakdown
    cursor.execute("SELECT expiry_date FROM drugs WHERE expiry_date IS NOT NULL AND TRIM(expiry_date) != ''")
    expiry_rows = cursor.fetchall()
    conn.close()

    expired_count = 0
    critical_count = 0  # 1-30 days
    warning_count = 0   # 31-60 days
    safe_count = 0      # >60 days

    for r in expiry_rows:
        parsed = parse_expiry_date(r["expiry_date"])
        if not parsed:
            continue
        days_left = (parsed - today).days
        if days_left < 0:
            expired_count += 1
        elif days_left <= 30:
            critical_count += 1
        elif days_left <= 60:
            warning_count += 1
        else:
            safe_count += 1

    return {
        "valuation": {
            "retail_value": retail_valuation,
            "cost_value": cost_valuation,
            "potential_margin": potential_margin,
            "total_items": total_items,
            "total_units": total_units
        },
        "top_dispensed": top_dispensed,
        "weekly_trend": {
            "labels": days_labels,
            "dispensed": dispensed_series,
            "received": received_series
        },
        "categories": categories,
        "expiry_distribution": {
            "expired": expired_count,
            "critical_30d": critical_count,
            "warning_60d": warning_count,
            "safe": safe_count
        }
    }

# ─────────────────────────────────────────────────────────────
# App Settings Management (Key-Value Configuration Layer)
# ─────────────────────────────────────────────────────────────

def get_app_setting(key: str, default=None):
    """Retrieve an application setting by key from SQLite settings table."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = ?", (str(key).strip(),))
        row = cursor.fetchone()
        conn.close()
        if row and row["value"] is not None:
            return row["value"]
        return default
    except Exception:
        return default

def set_app_setting(key: str, value: str):
    """Upsert an application setting into SQLite settings table."""
    try:
        conn = get_db()
        with conn:
            conn.execute("""
                INSERT INTO settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
            """, (str(key).strip(), str(value) if value is not None else "", get_now_str()))
        conn.close()
        return True
    except Exception:
        return False

# ─────────────────────────────────────────────────────────────
# Users & Audit Log Management (Google OAuth Access Control)
# ─────────────────────────────────────────────────────────────

def add_or_update_user(email: str, name: str = "", picture_url: str = "", google_sub: str = ""):
    """Insert or update authenticated user profile from Google OAuth."""
    if not email:
        return None
    now = get_now_str()
    conn = get_db()
    with conn:
        conn.execute("""
            INSERT INTO users (email, name, picture_url, google_sub, last_login, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(email) DO UPDATE SET
                name = CASE WHEN excluded.name != '' THEN excluded.name ELSE users.name END,
                picture_url = CASE WHEN excluded.picture_url != '' THEN excluded.picture_url ELSE users.picture_url END,
                google_sub = CASE WHEN excluded.google_sub != '' THEN excluded.google_sub ELSE users.google_sub END,
                last_login = excluded.last_login
        """, (email.strip(), name.strip(), picture_url.strip(), google_sub.strip(), now, now))
    conn.close()
    return get_user_by_email(email)

def get_user_by_email(email: str):
    """Retrieve user record by email."""
    if not email:
        return None
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email.strip(),))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_all_users():
    """Retrieve all logged-in users sorted by last login."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, email, name, picture_url, last_login, is_active, created_at FROM users ORDER BY last_login DESC, id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def log_audit_action(user_email: str, user_name: str = "", action: str = "", target_type: str = "", target_id = "", target_name: str = "", detail: str = "", ip_address: str = ""):
    """Record an audit trail log for system accountability."""
    try:
        conn = get_db()
        with conn:
            conn.execute("""
                INSERT INTO audit_logs (
                    user_email, user_name, action, target_type, target_id, target_name, detail, ip_address, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                str(user_email or "anonymous").strip(),
                str(user_name or "").strip(),
                str(action or "UNKNOWN").strip().upper(),
                str(target_type or "").strip(),
                str(target_id or "").strip(),
                str(target_name or "").strip(),
                str(detail or "").strip(),
                str(ip_address or "").strip(),
                get_now_str()
            ))
        conn.close()
        return True
    except Exception as e:
        print(f"Error logging audit action: {e}")
        return False

def get_audit_logs(limit: int = 200, user_email: str = None, action: str = None, date_filter: str = None):
    """Query audit logs with optional filters."""
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM audit_logs WHERE 1=1"
    params = []
    if user_email:
        query += " AND user_email LIKE ?"
        params.append(f"%{user_email.strip()}%")
    if action:
        query += " AND action = ?"
        params.append(action.strip().upper())
    if date_filter:
        query += " AND created_at LIKE ?"
        params.append(f"{date_filter.strip()}%")
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_stock_card_data(drug_id: int, start_date: str = None, end_date: str = None):
    """
    Retrieve unified chronological Stock Card ledger data for a specific drug.
    Combines stock-in (receive) and dispensing logs, calculates opening balance (ยอดยกมา),
    running balance, and details formatted for official hospital ledger card.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Fetch Drug Info
    cursor.execute("SELECT * FROM drugs WHERE id = ?", (drug_id,))
    drug_row = cursor.fetchone()
    if not drug_row:
        conn.close()
        return None
    drug = dict(drug_row)
    
    start_ts = f"{start_date.strip()} 00:00:00" if start_date and start_date.strip() else None
    end_ts = f"{end_date.strip()} 23:59:59" if end_date and end_date.strip() else None
    
    # 2. Fetch all transactions in period
    in_query = "SELECT * FROM stock_in_logs WHERE drug_id = ?"
    in_params = [drug_id]
    if start_ts:
        in_query += " AND created_at >= ?"
        in_params.append(start_ts)
    if end_ts:
        in_query += " AND created_at <= ?"
        in_params.append(end_ts)
    cursor.execute(in_query, in_params)
    stock_in_rows = [dict(r) for r in cursor.fetchall()]

    out_query = "SELECT * FROM dispensing_logs WHERE drug_id = ? AND is_voided = 0"
    out_params = [drug_id]
    if start_ts:
        out_query += " AND created_at >= ?"
        out_params.append(start_ts)
    if end_ts:
        out_query += " AND created_at <= ?"
        out_params.append(end_ts)
    cursor.execute(out_query, out_params)
    dispensing_rows = [dict(r) for r in cursor.fetchall()]

    total_in_period = sum(r.get("quantity", 0) for r in stock_in_rows)
    total_out_period = sum(r.get("quantity", 0) for r in dispensing_rows)
    
    # Calculate after end_ts
    total_in_after = 0
    total_out_after = 0
    if end_ts:
        cursor.execute("SELECT COALESCE(SUM(quantity), 0) FROM stock_in_logs WHERE drug_id = ? AND created_at > ?", (drug_id, end_ts))
        total_in_after = cursor.fetchone()[0] or 0
        cursor.execute("SELECT COALESCE(SUM(quantity), 0) FROM dispensing_logs WHERE drug_id = ? AND is_voided = 0 AND created_at > ?", (drug_id, end_ts))
        total_out_after = cursor.fetchone()[0] or 0
        
    current_stock = drug.get("stock_qty", 0)
    
    # Opening balance: Current Stock - (Net change during period) - (Net change after period)
    opening_balance = current_stock - (total_in_period - total_out_period) - (total_in_after - total_out_after)
    if opening_balance < 0:
        opening_balance = 0

    # 3. Build unified transaction items
    items = []
    for r in stock_in_rows:
        supplier_name = r.get("supplier") or "องค์การเภสัชกรรม (GPO)"
        items.append({
            "id": f"in-{r['id']}",
            "type": "RECEIVE",
            "created_at": r["created_at"],
            "qty_in": r["quantity"],
            "qty_out": None,
            "supplier": supplier_name,
            "recipient": "",
            "price": r.get("cost_per_unit") or drug.get("cost") or 0.0,
            "total_price": r.get("total_cost") or ((r.get("cost_per_unit") or 0.0) * r["quantity"]),
            "lot_number": r.get("lot_number") or drug.get("lot_number") or "",
            "expiry_date": r.get("expiry_date") or drug.get("expiry_date") or "",
            "sign": ""  # Explicitly blank for manual signature
        })

    for r in dispensing_rows:
        items.append({
            "id": f"out-{r['id']}",
            "type": "DISPENSE",
            "created_at": r["created_at"],
            "qty_in": None,
            "qty_out": r["quantity"],
            "supplier": "",
            "recipient": r.get("patient_name") or r.get("notes") or "ผู้ป่วยนอก / ห้องยา",
            "price": drug.get("cost") or drug.get("price") or 0.0,
            "total_price": (drug.get("cost") or drug.get("price") or 0.0) * r["quantity"],
            "lot_number": drug.get("lot_number") or "",
            "expiry_date": drug.get("expiry_date") or "",
            "sign": ""  # Explicitly blank for manual signature
        })

    # Sort chronologically ASC
    items.sort(key=lambda x: x["created_at"])

    # Calculate running balance and remaining stock value row by row
    running_balance = opening_balance
    unit_cost = (drug.get("cost") if (drug.get("cost") is not None and drug.get("cost") > 0) else (drug.get("price") or 0.0)) or 0.0
    
    def format_balance_val(val):
        if val is None or val == "":
            return "-"
        try:
            fval = float(val)
            if fval.is_integer():
                return f"{int(fval):,}"
            s = f"{fval:,.2f}"
            if s.endswith(".00"):
                return s[:-3]
            if s.endswith("0"):
                return s[:-1]
            return s
        except (ValueError, TypeError):
            return str(val)

    for item in items:
        if item["type"] == "RECEIVE":
            running_balance += item["qty_in"]
        elif item["type"] == "DISPENSE":
            running_balance -= item["qty_out"]
        item["balance"] = running_balance
        item["balance_value"] = running_balance * unit_cost
        item["balance_value_formatted"] = format_balance_val(item["balance_value"])

    opening_value = opening_balance * unit_cost
    opening_value_formatted = format_balance_val(opening_value)

    conn.close()
    return {
        "drug": drug,
        "opening_balance": opening_balance,
        "opening_value": opening_value,
        "opening_value_formatted": opening_value_formatted,
        "unit_cost": unit_cost,
        "closing_balance": running_balance,
        "total_in": total_in_period,
        "total_out": total_out_period,
        "transactions": items,
        "start_date": start_date or "",
        "end_date": end_date or ""
    }

def get_daily_requisition_available_dates():
    """
    Returns list of dates that have dispensing logs, plus the sample date.
    """
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT substr(created_at, 1, 10) as dt, count(*) as count
        FROM dispensing_logs
        GROUP BY dt
        ORDER BY dt DESC
    """)
    rows = cursor.fetchall()
    conn.close()

    result = []
    found_dates = set()
    for r in rows:
        dt = r["dt"]
        if dt:
            found_dates.add(dt)
            result.append({"date": dt, "count": r["count"]})

    if "2025-07-06" not in found_dates:
        result.append({"date": "2025-07-06", "count": 6, "is_sample": True})

    return result

def get_daily_requisition_data(date_str: str = None):
    """
    Retrieve aggregated daily requisition data for 'ใบเบิกเวชภัณฑ์ยาและเวชภัณฑ์มิใช่ยา'.
    Aggregates dispensing logs for the given date, detailing item names, units, 
    requested qty, dispensed qty, and remaining stock.
    Supports sample paper date (2025-07-06) and falls back to all logs if no active logs exist.
    """
    if not date_str or not date_str.strip():
        now_dt = datetime.now(BANGKOK_TZ)
        date_str = now_dt.strftime("%Y-%m-%d")
    else:
        date_str = date_str.strip()

    # Format Thai date components
    thai_months = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
                   "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
    thai_months_short = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                         "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    
    try:
        parts = date_str.split("-")
        y = int(parts[0])
        m = int(parts[1])
        d = int(parts[2])
        day_str = str(d)
        month_name = thai_months[m] if 1 <= m <= 12 else str(m)
        month_short = thai_months_short[m] if 1 <= m <= 12 else str(m)
        year_be = str(y + 543)
    except Exception:
        day_str = ""
        month_name = ""
        month_short = ""
        year_be = ""

    # Special handling for Sample / Example Date from official paper photo (6 ก.ค. 2568 / 2025-07-06)
    if date_str in ("2025-07-06", "2568-07-06"):
        sample_items = [
            {"drug_id": None, "name": "Medroxyprogesterone 50 mg/ml inj.", "unit": "vial", "qty_requested": 10, "qty_dispensed": 10, "remaining_stock": 25, "notes": ""},
            {"drug_id": None, "name": "Ambroxol syrup (Ammocab) 30 mg/5ml", "unit": "ขวด", "qty_requested": 20, "qty_dispensed": 20, "remaining_stock": 48, "notes": ""},
            {"drug_id": None, "name": "Bromhexine syrup 4 mg/5ml 60ml", "unit": "ขวด", "qty_requested": 15, "qty_dispensed": 15, "remaining_stock": 30, "notes": ""},
            {"drug_id": None, "name": "Paracetamol syrup (120mg/5ml) 60ml", "unit": "ขวด", "qty_requested": 30, "qty_dispensed": 30, "remaining_stock": 85, "notes": ""},
            {"drug_id": None, "name": "Face mask (หน้ากากอนามัยทางการแพทย์)", "unit": "กล่อง", "qty_requested": 5, "qty_dispensed": 5, "remaining_stock": 18, "notes": ""},
            {"drug_id": None, "name": "Dicyclomine 10 mg tab", "unit": "เม็ด", "qty_requested": 200, "qty_dispensed": 200, "remaining_stock": 500, "notes": ""},
        ]
        return {
            "date": "2025-07-06",
            "day": "6",
            "month_thai": "กรกฎาคม",
            "month_short": "ก.ค.",
            "year_be": "2568",
            "items": sample_items,
            "total_items": len(sample_items),
            "total_dispensed_qty": sum(it["qty_dispensed"] for it in sample_items),
            "hospital_name": "โรงพยาบาลส่งเสริมสุขภาพตำบลดอนนาลับ อำเภอบ้านดุง จังหวัดอุดรธานี",
            "requester_name": "นางสาวกรรณิกา ชัยเลิศ",
            "requester_title": "พยาบาลวิชาชีพชำนาญการ",
            "dispenser_name": "นางสาววราภรณ์ สีหนาจ",
            "dispenser_title": "พยาบาลวิชาชีพชำนาญการ",
            "authorizer_name": "นายชุมสาย วิชาชัย",
            "authorizer_title": "ผอ.รพ.สต.ดอนนาลับ",
            "receiver_name": "นางกัลตะนา เมืองจันทร์",
            "receiver_title": "พสอ.",
            "is_sample": True,
            "has_records": True
        }

    conn = get_db()
    cursor = conn.cursor()

    start_ts = f"{date_str} 00:00:00"
    end_ts = f"{date_str} 23:59:59"

    # 1. Fetch active (non-voided) logs first
    query_active = """
        SELECT 
            dispensing_logs.id,
            dispensing_logs.drug_id,
            COALESCE(drugs.name, dispensing_logs.drug_name, 'เวชภัณฑ์ไม่ระบุชื่อ') as drug_name,
            COALESCE(drugs.generic_name, '') as generic_name,
            COALESCE(drugs.unit, 'หน่วย') as unit,
            COALESCE(drugs.stock_qty, 0) as current_stock,
            dispensing_logs.quantity,
            dispensing_logs.patient_name,
            dispensing_logs.notes,
            dispensing_logs.created_at,
            dispensing_logs.is_voided
        FROM dispensing_logs
        LEFT JOIN drugs ON dispensing_logs.drug_id = drugs.id
        WHERE dispensing_logs.is_voided = 0
          AND dispensing_logs.created_at >= ?
          AND dispensing_logs.created_at <= ?
        ORDER BY dispensing_logs.id ASC
    """
    cursor.execute(query_active, (start_ts, end_ts))
    raw_logs = [dict(r) for r in cursor.fetchall()]

    # 2. Fallback: if no active logs exist for this date, query all logs for that date
    # (so dates like 2026-10-14 that had testing/voided records will still display their items)
    if not raw_logs:
        query_all = """
            SELECT 
                dispensing_logs.id,
                dispensing_logs.drug_id,
                COALESCE(drugs.name, dispensing_logs.drug_name, 'เวชภัณฑ์ไม่ระบุชื่อ') as drug_name,
                COALESCE(drugs.generic_name, '') as generic_name,
                COALESCE(drugs.unit, 'หน่วย') as unit,
                COALESCE(drugs.stock_qty, 0) as current_stock,
                dispensing_logs.quantity,
                dispensing_logs.patient_name,
                dispensing_logs.notes,
                dispensing_logs.created_at,
                dispensing_logs.is_voided
            FROM dispensing_logs
            LEFT JOIN drugs ON dispensing_logs.drug_id = drugs.id
            WHERE dispensing_logs.created_at >= ?
              AND dispensing_logs.created_at <= ?
            ORDER BY dispensing_logs.id ASC
        """
        cursor.execute(query_all, (start_ts, end_ts))
        raw_logs = [dict(r) for r in cursor.fetchall()]

    # Group by drug_id (or drug_name if drug_id is null)
    items_map = {}
    for log in raw_logs:
        name_cand = (log.get("generic_name") or log.get("drug_name") or "").strip()
        # Filter out invalid / garbage test entries
        if name_cand in ("22", "?", ""):
            if log.get("drug_name") and log.get("drug_name") not in ("22", "?", ""):
                name_cand = log.get("drug_name")
            else:
                continue

        key = log["drug_id"] if log["drug_id"] else name_cand
        qty = log.get("quantity") or 0
        if key not in items_map:
            display_name = log["generic_name"] if log["generic_name"] else log["drug_name"]
            items_map[key] = {
                "drug_id": log["drug_id"],
                "name": display_name,
                "unit": log["unit"] or "หน่วย",
                "qty_requested": qty,
                "qty_dispensed": qty,
                "remaining_stock": log["current_stock"],
                "notes": ""
            }
        else:
            items_map[key]["qty_requested"] += qty
            items_map[key]["qty_dispensed"] += qty

    items = list(items_map.values())
    conn.close()

    return {
        "date": date_str,
        "day": day_str,
        "month_thai": month_name,
        "month_short": month_short,
        "year_be": year_be,
        "items": items,
        "total_items": len(items),
        "total_dispensed_qty": sum(it["qty_dispensed"] for it in items),
        "hospital_name": "โรงพยาบาลส่งเสริมสุขภาพตำบลดอนนาลับ อำเภอบ้านดุง จังหวัดอุดรธานี",
        "requester_name": "นางสาวกรรณิกา ชัยเลิศ",
        "requester_title": "พยาบาลวิชาชีพชำนาญการ",
        "dispenser_name": "นางสาววราภรณ์ สีหนาจ",
        "dispenser_title": "พยาบาลวิชาชีพชำนาญการ",
        "authorizer_name": "นายชุมสาย วิชาชัย",
        "authorizer_title": "ผอ.รพ.สต.ดอนนาลับ",
        "receiver_name": "นางกัลตะนา เมืองจันทร์",
        "receiver_title": "พสอ.",
        "has_records": len(items) > 0
    }

# Initialize on module import
init_db()
