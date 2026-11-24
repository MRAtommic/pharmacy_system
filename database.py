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

def to_num(val, default=0):
    """Safely parse numbers without rounding or losing decimal precision."""
    if val is None or val == "":
        return default
    try:
        f = float(val)
        return int(f) if f.is_integer() else f
    except (ValueError, TypeError):
        return default

def get_db():
    conn = sqlite3.connect(Config.DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    conn.execute("PRAGMA cache_size = -64000")
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

        # Migration: packaging (e.g. "10x10"), units per pack (100 tablets per box) and the pack's name
        for col, col_type in [("packaging", "TEXT DEFAULT ''"), ("pack_size", "REAL"), ("pack_unit", "TEXT DEFAULT 'กล่อง'"), ("opening_fiscal_year", "TEXT DEFAULT ''")]:
            try:
                conn.execute(f"ALTER TABLE drugs ADD COLUMN {col} {col_type}")
            except sqlite3.OperationalError:
                pass

        # Table: Drug Lots (Sub-batches per Drug Master)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS drug_lots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                drug_id INTEGER NOT NULL,
                lot_number TEXT NOT NULL,
                stock_qty INTEGER NOT NULL DEFAULT 0,
                initial_qty INTEGER NOT NULL DEFAULT 0,
                cost_per_unit REAL DEFAULT 0.0,
                expiry_date TEXT,
                location TEXT DEFAULT '',
                qr_payload TEXT,
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                is_active INTEGER DEFAULT 1,
                FOREIGN KEY (drug_id) REFERENCES drugs (id) ON DELETE CASCADE,
                UNIQUE(drug_id, lot_number)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_drug_lots_drug ON drug_lots(drug_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_drug_lots_exp ON drug_lots(expiry_date)")

        # Migration: Ensure lot_id column in stock_in_logs and dispensing_logs
        try:
            conn.execute("ALTER TABLE stock_in_logs ADD COLUMN lot_id INTEGER")
        except sqlite3.OperationalError:
            pass

        try:
            conn.execute("ALTER TABLE dispensing_logs ADD COLUMN lot_id INTEGER")
        except sqlite3.OperationalError:
            pass

        try:
            conn.execute("ALTER TABLE dispensing_logs ADD COLUMN lot_number TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass

        # Data Migration: Populate drug_lots from existing drugs if drug_lots is empty
        try:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM drug_lots")
            lots_count = cur.fetchone()[0]
            if lots_count == 0:
                cur.execute("SELECT id, code, name, stock_qty, cost, expiry_date, lot_number, location, created_at FROM drugs")
                drugs_rows = cur.fetchall()
                now_str = get_now_str()
                for dr in drugs_rows:
                    lot_no = (dr["lot_number"] or "").strip() or "LOT-DEFAULT"
                    qr_p = f"{dr['code']}#{lot_no}"
                    cur.execute("""
                        INSERT OR IGNORE INTO drug_lots (
                            drug_id, lot_number, stock_qty, initial_qty, cost_per_unit,
                            expiry_date, location, qr_payload, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        dr["id"], lot_no, dr["stock_qty"], dr["stock_qty"], dr["cost"] or 0.0,
                        dr["expiry_date"], dr["location"] or "", qr_p, dr["created_at"] or now_str, now_str
                    ))
        except Exception as e:
            logger.warning(f"Error migrating initial drug_lots: {e}")

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
        for col, col_type in [("is_voided", "INTEGER DEFAULT 0"), ("void_reason", "TEXT DEFAULT ''"), ("voided_by", "TEXT DEFAULT ''"), ("voided_at", "TEXT DEFAULT ''"), ("batch_id", "TEXT DEFAULT ''"),
                          # price / cost per unit AT THE TIME of dispensing (old rows stay NULL and fall back to the drug's current values)
                          ("unit_price", "REAL"), ("unit_cost", "REAL")]:
            try:
                conn.execute(f"ALTER TABLE dispensing_logs ADD COLUMN {col} {col_type}")
            except sqlite3.OperationalError:
                pass

        # Table: stock adjustments (manual lot edits / lot deletions) so the stock card can always reconcile
        conn.execute("""
            CREATE TABLE IF NOT EXISTS stock_adjustments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                drug_id INTEGER,
                lot_id INTEGER,
                lot_number TEXT,
                quantity_delta REAL NOT NULL,
                reason TEXT DEFAULT '',
                adjusted_by TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (drug_id) REFERENCES drugs (id) ON DELETE SET NULL
            )
        """)

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

        # Migration: Add void tracking columns to stock_in_logs if missing
        try:
            cur = conn.cursor()
            cur.execute("PRAGMA table_info(stock_in_logs)")
            existing_stock_in_cols = [c[1] for c in cur.fetchall()]
            if "is_voided" not in existing_stock_in_cols:
                conn.execute("ALTER TABLE stock_in_logs ADD COLUMN is_voided INTEGER DEFAULT 0")
            if "void_reason" not in existing_stock_in_cols:
                conn.execute("ALTER TABLE stock_in_logs ADD COLUMN void_reason TEXT")
            if "voided_by" not in existing_stock_in_cols:
                conn.execute("ALTER TABLE stock_in_logs ADD COLUMN voided_by TEXT")
            if "voided_at" not in existing_stock_in_cols:
                conn.execute("ALTER TABLE stock_in_logs ADD COLUMN voided_at TEXT")
        except Exception as e:
            logger.warning(f"Error migrating stock_in_logs void columns: {e}")

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

        # Auto-seeding of sample drugs is disabled so inventory remains clean
        pass
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

def get_drug_lots(drug_id, active_only=False):
    """
    Fetch all lots for a specific drug, ordered by expiry_date ASC (FEFO).
    Calculates days_left, urgency status, and returns list of lot dicts.
    """
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM drug_lots WHERE drug_id = ?"
    params = [drug_id]
    if active_only:
        query += " AND stock_qty > 0 AND is_active = 1"
    query += " ORDER BY CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END, expiry_date ASC, id ASC"
    cursor.execute(query, params)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()

    today = datetime.now(BANGKOK_TZ).date()
    for lot in rows:
        exp_date = parse_expiry_date(lot.get("expiry_date"))
        if exp_date:
            days_left = (exp_date - today).days
            lot["days_left"] = days_left
            lot["is_expired"] = days_left < 0
            lot["is_expiring_soon"] = days_left <= 60
            if days_left < 0:
                lot["urgency"] = "expired"
                lot["urgency_text"] = f"หมดอายุแล้ว ({abs(days_left)} วัน)"
            elif days_left <= 30:
                lot["urgency"] = "critical"
                lot["urgency_text"] = f"ด่วนมาก ({days_left} วัน)"
            elif days_left <= 60:
                lot["urgency"] = "warning"
                lot["urgency_text"] = f"ใกล้หมด ({days_left} วัน)"
            else:
                lot["urgency"] = "normal"
                lot["urgency_text"] = f"ปกติ ({days_left} วัน)"
        else:
            lot["days_left"] = None
            lot["is_expired"] = False
            lot["is_expiring_soon"] = False
            lot["urgency"] = "unknown"
            lot["urgency_text"] = "-"
    return rows

def get_lot_by_id(lot_id):
    """Fetch single lot by its ID with parent drug details."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT l.*, d.name as drug_name, d.code as drug_code, d.unit as drug_unit, 
               d.category as drug_category, d.dosage_form as drug_dosage_form, 
               d.instructions as drug_instructions, d.price as drug_price
        FROM drug_lots l
        JOIN drugs d ON l.drug_id = d.id
        WHERE l.id = ?
    """, (lot_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    lot = dict(row)
    today = datetime.now(BANGKOK_TZ).date()
    exp_date = parse_expiry_date(lot.get("expiry_date"))
    if exp_date:
        days_left = (exp_date - today).days
        lot["days_left"] = days_left
        lot["is_expired"] = days_left < 0
        lot["is_expiring_soon"] = days_left <= 60
    else:
        lot["days_left"] = None
        lot["is_expired"] = False
        lot["is_expiring_soon"] = False
    return lot

def sync_drug_master_fefo(drug_id, conn=None):
    """
    Recalculate drug master record's total stock_qty, FEFO expiry_date,
    and current active lot_number based on active lots in drug_lots.
    Can be run within an existing connection transaction or opens get_db().
    """
    should_close = False
    if conn is None:
        conn = get_db()
        should_close = True
    
    try:
        cur = conn.cursor()
        # Sum total stock across lots
        cur.execute("SELECT COALESCE(ROUND(SUM(stock_qty), 6), 0) FROM drug_lots WHERE drug_id = ? AND is_active = 1", (drug_id,))
        total_stock = cur.fetchone()[0]

        # Get earliest active lot with stock > 0 for FEFO tracking
        cur.execute("""
            SELECT lot_number, expiry_date 
            FROM drug_lots 
            WHERE drug_id = ? AND is_active = 1 AND stock_qty > 0
            ORDER BY CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END, expiry_date ASC, id ASC
            LIMIT 1
        """, (drug_id,))
        earliest = cur.fetchone()
        
        now = get_now_str()
        if earliest:
            cur.execute("""
                UPDATE drugs 
                SET stock_qty = ?, lot_number = ?, expiry_date = ?, updated_at = ?
                WHERE id = ?
            """, (total_stock, earliest["lot_number"] or "", earliest["expiry_date"] or "", now, drug_id))
        else:
            # Fallback if all lots empty: keep total_stock
            cur.execute("""
                UPDATE drugs 
                SET stock_qty = ?, updated_at = ?
                WHERE id = ?
            """, (total_stock, now, drug_id))
        
        if should_close:
            conn.commit()
    finally:
        if should_close:
            conn.close()

def update_lot(lot_id, lot_number=None, stock_qty=None, expiry_date=None, cost_per_unit=None, notes=None, adjusted_by=""):
    """
    Update an existing drug lot record and synchronize the parent drug master (stock_qty, FEFO lot/expiry).
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM drug_lots WHERE id = ?", (lot_id,))
        lot = cur.fetchone()
        if not lot:
            return {"ok": False, "error": "ไม่พบข้อมูลล็อตยา"}
        lot = dict(lot)
        drug_id = lot["drug_id"]

        # Fetch drug code to recalculate qr_payload if lot_number changes
        cur.execute("SELECT code FROM drugs WHERE id = ?", (drug_id,))
        drug_row = cur.fetchone()
        drug_code = drug_row["code"] if drug_row else ""

        new_lot_number = lot["lot_number"] if lot_number is None else str(lot_number).strip()
        if not new_lot_number:
            return {"ok": False, "error": "กรุณาระบุเลขล็อต"}

        # Check unique constraint on (drug_id, lot_number) for other lots
        cur.execute("SELECT id FROM drug_lots WHERE drug_id = ? AND lot_number = ? AND id != ?", (drug_id, new_lot_number, lot_id))
        if cur.fetchone():
            return {"ok": False, "error": f"เลขล็อต '{new_lot_number}' ซ้ำกับล็อตอื่นของยานี้"}

        try:
            if stock_qty is None:
                new_stock_qty = lot["stock_qty"]
            else:
                f_qty = float(stock_qty)
                if f_qty < 0:
                    return {"ok": False, "error": "จำนวนคงเหลือต้องไม่ต่ำกว่า 0"}
                new_stock_qty = int(f_qty) if f_qty.is_integer() else f_qty
        except (ValueError, TypeError):
            return {"ok": False, "error": "จำนวนคงเหลือต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป"}

        new_expiry = lot["expiry_date"] if expiry_date is None else (str(expiry_date).strip() if expiry_date else "")
        try:
            new_cost = lot["cost_per_unit"] if cost_per_unit is None else (float(cost_per_unit) if cost_per_unit not in ("", None) else 0.0)
        except (ValueError, TypeError):
            new_cost = lot["cost_per_unit"]
        new_notes = lot["notes"] if notes is None else (str(notes).strip() if notes else "")

        qr_payload = f"{drug_code}#{new_lot_number}"
        now = get_now_str()

        cur.execute("""
            UPDATE drug_lots
            SET lot_number = ?, stock_qty = ?, expiry_date = ?, cost_per_unit = ?, notes = ?, qr_payload = ?, updated_at = ?
            WHERE id = ?
        """, (new_lot_number, new_stock_qty, new_expiry, new_cost, new_notes, qr_payload, now, lot_id))

        # A manual change of the lot quantity must be visible in the stock card
        delta = float(new_stock_qty) - float(lot["stock_qty"] or 0)
        if abs(delta) > 1e-9:
            cur.execute("""
                INSERT INTO stock_adjustments (drug_id, lot_id, lot_number, quantity_delta, reason, adjusted_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (drug_id, lot_id, new_lot_number, delta, "แก้ไขจำนวนในล็อต", adjusted_by or "", now))

        # Synchronize drug master record
        sync_drug_master_fefo(drug_id, conn=conn)

        conn.commit()
        return {"ok": True, "lot_id": lot_id, "drug_id": drug_id, "message": "อัปเดตข้อมูลล็อตเรียบร้อยแล้ว"}
    except Exception as e:
        logger.error(f"Error updating lot {lot_id}: {e}")
        return {"ok": False, "error": str(e)}
    finally:
        conn.close()

def delete_lot(lot_id, adjusted_by=""):
    """
    Delete a lot and synchronize parent drug master.
    """
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM drug_lots WHERE id = ?", (lot_id,))
        lot = cur.fetchone()
        if not lot:
            return {"ok": False, "error": "ไม่พบข้อมูลล็อตยา"}
        lot = dict(lot)
        drug_id = lot["drug_id"]

        # Check total lots of this drug
        cur.execute("SELECT COUNT(*) FROM drug_lots WHERE drug_id = ?", (drug_id,))
        total_lots = cur.fetchone()[0]
        if total_lots <= 1:
            return {"ok": False, "error": "ไม่สามารถลบล็อตสุดท้ายได้ (ยาต้องมีอย่างน้อย 1 ล็อต หากไม่ต้องการใช้ยานี้ ให้ลบที่ตัวยา)"}

        if float(lot.get("stock_qty") or 0) > 0:
            cur.execute("""
                INSERT INTO stock_adjustments (drug_id, lot_id, lot_number, quantity_delta, reason, adjusted_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (drug_id, lot_id, lot.get("lot_number") or "", -float(lot["stock_qty"]), "ลบล็อต", adjusted_by or "", get_now_str()))

        cur.execute("DELETE FROM drug_lots WHERE id = ?", (lot_id,))
        sync_drug_master_fefo(drug_id, conn=conn)
        conn.commit()
        return {"ok": True, "drug_id": drug_id, "message": "ลบล็อตยาเรียบร้อยแล้ว"}
    except Exception as e:
        logger.error(f"Error deleting lot {lot_id}: {e}")
        return {"ok": False, "error": str(e)}
    finally:
        conn.close()

def get_all_drugs(search_query=None, category=None, low_stock_only=False, expiring_soon_days=None):
    """Fetch drugs with optional search, expiration filters, and attached active lots."""
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

    # Batch fetch all lots in single query for optimal performance
    cur_lots = conn.cursor()
    cur_lots.execute("""
        SELECT * FROM drug_lots 
        ORDER BY CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END, expiry_date ASC, id ASC
    """)
    all_lots_rows = [dict(r) for r in cur_lots.fetchall()]
    conn.close()

    # Calculate days_left and urgency for each drug & lot
    today = datetime.now(BANGKOK_TZ).date()

    lots_by_drug = {}
    for lot in all_lots_rows:
        exp_date = parse_expiry_date(lot.get("expiry_date"))
        if exp_date:
            days_left = (exp_date - today).days
            lot["days_left"] = days_left
            lot["is_expired"] = days_left < 0
            lot["is_expiring_soon"] = days_left <= 60
            if days_left < 0:
                lot["urgency"] = "expired"
                lot["urgency_text"] = f"หมดอายุแล้ว ({abs(days_left)} วัน)"
            elif days_left <= 30:
                lot["urgency"] = "critical"
                lot["urgency_text"] = f"ด่วนมาก ({days_left} วัน)"
            elif days_left <= 60:
                lot["urgency"] = "warning"
                lot["urgency_text"] = f"ใกล้หมด ({days_left} วัน)"
            else:
                lot["urgency"] = "normal"
                lot["urgency_text"] = f"ปกติ ({days_left} วัน)"
        else:
            lot["days_left"] = None
            lot["is_expired"] = False
            lot["is_expiring_soon"] = False
            lot["urgency"] = "unknown"
            lot["urgency_text"] = "-"

        d_id = lot["drug_id"]
        if d_id not in lots_by_drug:
            lots_by_drug[d_id] = []
        lots_by_drug[d_id].append(lot)

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

        drug_lots = lots_by_drug.get(d["id"], [])
        d["lots"] = drug_lots
        d["lot_count"] = len(drug_lots)
        d["active_lot_count"] = sum(1 for l in drug_lots if l.get("stock_qty", 0) > 0 and l.get("is_active", 1) == 1)

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

def _norm_pack_size(value):
    """Units per pack (e.g. 100 tablets per box). Anything not greater than 1 means 'no pack' -> None."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return _clean_num(v) if v > 1 else None


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
                lot_number, location, image_url, qr_payload, instructions, created_at, updated_at,
                packaging, pack_size, pack_unit, opening_fiscal_year
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            code,
            data.get("name", "").strip(),
            data.get("generic_name", "").strip(),
            data.get("category", "ทั่วไป"),
            data.get("dosage_form", "เม็ด (Tablet)"),
            data.get("strength", "").strip(),
            to_num(data.get("stock_qty"), 0),
            data.get("unit", "เม็ด").strip(),
            to_num(data.get("min_threshold"), 10),
            float(data.get("price") or 0.0),
            float(data.get("cost") or 0.0),
            data.get("expiry_date", ""),
            data.get("lot_number", "").strip(),
            data.get("location", "ตู้เก็บยาหลัก"),
            data.get("image_url", "").strip(),
            qr_payload,
            data.get("instructions", ""),
            now,
            now,
            (data.get("packaging") or "").strip(),
            _norm_pack_size(data.get("pack_size")),
            (data.get("pack_unit") or "กล่อง").strip() or "กล่อง",
            str(data.get("opening_fiscal_year") or "").strip()
        ))
        drug_id = cursor.lastrowid

        # Automatically create initial lot entry in drug_lots
        init_stock = to_num(data.get("stock_qty"), 0)
        init_lot = (data.get("lot_number") or "").strip() or f"LOT-{datetime.now(BANGKOK_TZ).strftime('%y%m%d')}"
        init_exp = (data.get("expiry_date") or "").strip()
        init_cost = float(data.get("cost") or 0.0)
        init_loc = (data.get("location") or "ตู้เก็บยาหลัก").strip()
        lot_qr = f"{code}#{init_lot}"
        cursor.execute("""
            INSERT OR IGNORE INTO drug_lots (
                drug_id, lot_number, stock_qty, initial_qty, cost_per_unit,
                expiry_date, location, qr_payload, created_at, updated_at, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """, (drug_id, init_lot, init_stock, init_stock, init_cost, init_exp, init_loc, lot_qr, now, now))
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

        pack_updates = {}
        if "packaging" in data:
            pack_updates["packaging"] = (data.get("packaging") or "").strip()
        if "pack_size" in data:
            pack_updates["pack_size"] = _norm_pack_size(data.get("pack_size"))
        if "pack_unit" in data:
            pack_updates["pack_unit"] = (data.get("pack_unit") or "กล่อง").strip() or "กล่อง"
        if "opening_fiscal_year" in data:
            pack_updates["opening_fiscal_year"] = str(data.get("opening_fiscal_year") or "").strip()
        if pack_updates:
            # the keys above are fixed column names, never user input
            conn.execute(f"UPDATE drugs SET {', '.join(k + ' = ?' for k in pack_updates)} WHERE id = ?",
                         (*pack_updates.values(), drug_id))
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

def deduct_stock(drug_id_or_code, quantity, channel="WEB_MANUAL", dispensed_by="เจ้าหน้าที่", patient_name="", drive_file_id=None, drive_file_link=None, notes="", lot_id=None):
    """
    Atomically deduct stock from a drug and insert a dispensing log.
    Supports specific lot deduction or automatic FEFO deduction across active batches.
    Thread-safe and race-condition protected.
    Returns: (success: bool, result_dict or error_message)
    """
    try:
        qty_num = float(quantity)
        if qty_num <= 0:
            return False, "จำนวนที่ตัดต้องมากกว่า 0"
        qty = int(qty_num) if qty_num.is_integer() else qty_num
    except (ValueError, TypeError):
        return False, "จำนวนที่ตัดต้องเป็นตัวเลขมากกว่า 0"

    qty_int = qty  # used in the result payload / price calculation below

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

                # 2. Check & deduct lot stock
                target_lot_id = None
                target_lot_number = ""

                if lot_id:
                    cursor.execute("SELECT * FROM drug_lots WHERE id = ? AND drug_id = ?", (int(lot_id), drug_id))
                    lot_row = cursor.fetchone()
                    if not lot_row:
                        return False, f"ไม่พบข้อมูลล็อตยา #{lot_id} สำหรับยานี้"
                    lot_dict = dict(lot_row)
                    if lot_dict["stock_qty"] < qty:
                        return False, f"ล็อต '{lot_dict['lot_number']}' มียาคงเหลือเพียง {lot_dict['stock_qty']} {drug['unit']} (ไม่พอตัด {qty} {drug['unit']})"
                    cursor.execute("""
                        UPDATE drug_lots 
                        SET stock_qty = stock_qty - ?, updated_at = ? 
                        WHERE id = ?
                    """, (qty, now, lot_dict["id"]))
                    target_lot_id = lot_dict["id"]
                    target_lot_number = lot_dict["lot_number"]
                else:
                    # FEFO Auto deduction across active lots
                    cursor.execute("""
                        SELECT * FROM drug_lots 
                        WHERE drug_id = ? AND is_active = 1 AND stock_qty > 0 
                        ORDER BY CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END, expiry_date ASC, id ASC
                    """, (drug_id,))
                    active_lots = [dict(r) for r in cursor.fetchall()]
                    rem = qty
                    for al in active_lots:
                        take = min(al["stock_qty"], rem)
                        take_clean = int(take) if isinstance(take, float) and take.is_integer() else take
                        cursor.execute("""
                            UPDATE drug_lots 
                            SET stock_qty = stock_qty - ?, updated_at = ? 
                            WHERE id = ?
                        """, (take_clean, now, al["id"]))
                        rem -= take
                        if target_lot_id is None:
                            target_lot_id = al["id"]
                            target_lot_number = al["lot_number"]
                        elif al["lot_number"] not in target_lot_number:
                            target_lot_number += f", {al['lot_number']}"
                        if rem <= 0:
                            break

                # 3. Atomic decrement from master drugs table
                cursor.execute("""
                    UPDATE drugs 
                    SET stock_qty = stock_qty - ?, updated_at = ? 
                    WHERE id = ? AND stock_qty >= ?
                    RETURNING stock_qty, (stock_qty + ?) AS balance_before
                """, (qty, now, drug_id, qty, qty))

                update_row = cursor.fetchone()
                if not update_row:
                    cursor.execute("SELECT stock_qty FROM drugs WHERE id = ?", (drug_id,))
                    cur_row = cursor.fetchone()
                    cur_stock = cur_row[0] if cur_row else 0
                    return False, f"สต็อกไม่เพียงพอ! มียา '{drug['name']}' เหลืออยู่เพียง {cur_stock} {drug['unit']} (ต้องการตัด {qty} {drug['unit']})"

                new_stock = update_row[0]
                current_stock = update_row[1]

                # Sync master FEFO expiry and lot_number
                sync_drug_master_fefo(drug_id, conn=conn)

                # 4. Insert dispensing log
                cursor.execute("""
                    INSERT INTO dispensing_logs (
                        drug_id, drug_code, drug_name, lot_id, lot_number, quantity,
                        balance_before, balance_after, channel,
                        dispensed_by, patient_name, drive_file_id,
                        drive_file_link, notes, synced_to_sheet, created_at, unit_price, unit_cost
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
                """, (
                    drug["id"],
                    drug["code"],
                    drug["name"],
                    target_lot_id,
                    target_lot_number,
                    qty,
                    current_stock,
                    new_stock,
                    channel,
                    dispensed_by,
                    patient_name,
                    drive_file_id,
                    drive_file_link,
                    notes,
                    now,
                    float(drug.get("price") or 0.0),
                    float(drug.get("cost") or 0.0)
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
                    "lot_id": target_lot_id,
                    "lot_number": target_lot_number,
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
    items: list of dicts: [{"drug_id": int/str, "quantity": int, "lot_id": int (optional), "notes": str (optional)}]
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
            qty_val = float(item.get("quantity", 0))
            if qty_val <= 0:
                return False, f"รายการที่ {idx}: จำนวนที่ตัดต้องมากกว่า 0"
            item_qty = int(qty_val) if qty_val.is_integer() else qty_val
        except (ValueError, TypeError):
            return False, f"รายการที่ {idx}: จำนวนที่ตัดต้องเป็นตัวเลขมากกว่า 0"

        demand_by_drug[str(drug_ref)] = demand_by_drug.get(str(drug_ref), 0.0) + item_qty
        cleaned_items.append({
            "drug_ref": drug_ref,
            "quantity": item_qty,
            "lot_id": item.get("lot_id"),
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
                    cur_stock_val = float(drug_dict.get("stock_qty") or 0.0)
                    cur_stock = int(cur_stock_val) if cur_stock_val.is_integer() else cur_stock_val
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
                    item_lot_id = it.get("lot_id")

                    # Deduct from specific lot or FEFO
                    target_lot_id = None
                    target_lot_number = ""
                    if item_lot_id:
                        cursor.execute("SELECT * FROM drug_lots WHERE id = ? AND drug_id = ?", (int(item_lot_id), d_id))
                        l_row = cursor.fetchone()
                        if l_row:
                            l_dict = dict(l_row)
                            if l_dict["stock_qty"] >= q:
                                cursor.execute("UPDATE drug_lots SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?", (q, now, l_dict["id"]))
                                target_lot_id = l_dict["id"]
                                target_lot_number = l_dict["lot_number"]
                    
                    if target_lot_id is None:
                        # FEFO across active lots
                        cursor.execute("""
                            SELECT * FROM drug_lots 
                            WHERE drug_id = ? AND is_active = 1 AND stock_qty > 0 
                            ORDER BY CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END, expiry_date ASC, id ASC
                        """, (d_id,))
                        active_lots = [dict(r) for r in cursor.fetchall()]
                        rem = q
                        for al in active_lots:
                            take = min(al["stock_qty"], rem)
                            cursor.execute("UPDATE drug_lots SET stock_qty = stock_qty - ?, updated_at = ? WHERE id = ?", (take, now, al["id"]))
                            rem -= take
                            if target_lot_id is None:
                                target_lot_id = al["id"]
                                target_lot_number = al["lot_number"]
                            elif al["lot_number"] not in target_lot_number:
                                target_lot_number += f", {al['lot_number']}"
                            if rem <= 0:
                                break

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

                    # Sync master FEFO
                    sync_drug_master_fefo(d_id, conn=conn)

                    cursor.execute("""
                        INSERT INTO dispensing_logs (
                            drug_id, drug_code, drug_name, lot_id, lot_number, quantity,
                            balance_before, balance_after, channel,
                            dispensed_by, patient_name, drive_file_id,
                            drive_file_link, notes, synced_to_sheet, created_at, batch_id, unit_price, unit_cost
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 0, ?, ?, ?, ?)
                    """, (
                        d_id,
                        drug_dict["code"],
                        drug_dict["name"],
                        target_lot_id,
                        target_lot_number,
                        q,
                        current_stock,
                        new_stock,
                        channel,
                        dispensed_by,
                        patient_name,
                        item_note,
                        now,
                        batch_id,
                        float(drug_dict.get("price") or 0.0),
                        float(drug_dict.get("cost") or 0.0)
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
                        "lot_id": target_lot_id,
                        "lot_number": target_lot_number,
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
            COALESCE(dispensing_logs.unit_price, drugs.price, 0.0) AS price,
            COALESCE(dispensing_logs.unit_cost, drugs.cost, 0.0) AS cost,
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
            COALESCE(dispensing_logs.unit_price, drugs.price, 0) AS price,
            COALESCE(dispensing_logs.unit_cost, drugs.cost, 0) AS cost
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
            COALESCE(dispensing_logs.unit_price, drugs.price, 0) AS price,
            COALESCE(dispensing_logs.unit_cost, drugs.cost, 0) AS cost
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
                lot_id = log.get("lot_id")

                # 1. Restore stock to drug lot & master if drug still exists
                new_stock = None
                if lot_id:
                    cursor.execute("UPDATE drug_lots SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?", (qty, now, lot_id))

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
                    sync_drug_master_fefo(drug_id, conn=conn)

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
            COALESCE(SUM(dispensing_logs.quantity * COALESCE(dispensing_logs.unit_price, drugs.price, 0)), 0.0)
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
        qty_num = float(quantity)
        if qty_num <= 0:
            return False, "จำนวนที่รับเข้าต้องมากกว่า 0"
        qty = int(qty_num) if qty_num.is_integer() else qty_num
    except (ValueError, TypeError):
        return False, "จำนวนที่รับเข้าต้องเป็นตัวเลขมากกว่า 0"

    qty_int = qty  # used in the result payload below

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
                total_cost = unit_cost * qty

                current_stock_val = float(drug.get("stock_qty") or 0.0)
                current_stock = int(current_stock_val) if current_stock_val.is_integer() else current_stock_val
                current_cost = float(drug.get("cost") or 0.0)
                if current_stock > 0 and current_cost > 0:
                    weighted_unit_cost = ((current_stock * current_cost) + (qty * unit_cost)) / (current_stock + qty)
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

                lot_no = lot_number.strip() if lot_number and str(lot_number).strip() else f"LOT-{datetime.now(BANGKOK_TZ).strftime('%y%m%d')}"

                # 2. Upsert into drug_lots
                cursor.execute("SELECT id, stock_qty, initial_qty FROM drug_lots WHERE drug_id = ? AND lot_number = ?", (drug_id, lot_no))
                existing_lot = cursor.fetchone()
                if existing_lot:
                    lot_id = existing_lot["id"]
                    cursor.execute("""
                        UPDATE drug_lots 
                        SET stock_qty = stock_qty + ?, 
                            initial_qty = initial_qty + ?, 
                            cost_per_unit = ?, 
                            expiry_date = COALESCE(NULLIF(?, ''), expiry_date),
                            updated_at = ?, 
                            is_active = 1 
                        WHERE id = ?
                    """, (qty, qty, unit_cost, incoming_exp, now, lot_id))
                else:
                    lot_qr = f"{drug['code']}#{lot_no}"
                    cursor.execute("""
                        INSERT INTO drug_lots (
                            drug_id, lot_number, stock_qty, initial_qty, cost_per_unit,
                            expiry_date, location, qr_payload, notes, created_at, updated_at, is_active
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """, (drug_id, lot_no, qty, qty, unit_cost, incoming_exp, drug.get("location", ""), lot_qr, notes or "", now, now))
                    lot_id = cursor.lastrowid

                # 3. Update drugs master total stock and weighted cost
                cursor.execute("""
                    UPDATE drugs SET 
                        stock_qty = stock_qty + ?,
                        cost = ?,
                        updated_at = ?
                    WHERE id = ?
                    RETURNING stock_qty, (stock_qty - ?) AS balance_before
                """, (qty, weighted_unit_cost, now, drug_id, qty))

                row_update = cursor.fetchone()
                new_stock = row_update[0]
                current_stock = row_update[1]

                # Sync master FEFO lot and expiry
                sync_drug_master_fefo(drug_id, conn=conn)

                # 4. Insert stock_in_logs including lot_id
                cursor.execute("""
                    INSERT INTO stock_in_logs (
                        drug_id, drug_code, drug_name, lot_number, lot_id, quantity,
                        balance_before, balance_after, cost_per_unit, total_cost,
                        supplier, expiry_date, received_by, notes, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    drug["id"],
                    drug["code"],
                    drug["name"],
                    lot_no,
                    lot_id,
                    qty,
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
                    "lot_id": lot_id,
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

def get_stock_in_log(log_id):
    """Retrieve single stock-in log by id with joined drug details."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            stock_in_logs.*,
            COALESCE(drugs.image_url, '') AS image_url,
            COALESCE(drugs.unit, 'หน่วย') AS unit,
            COALESCE(drugs.category, '-') AS category,
            COALESCE(drugs.generic_name, '') AS generic_name,
            COALESCE(drugs.stock_qty, 0) AS current_drug_stock
        FROM stock_in_logs
        LEFT JOIN drugs ON stock_in_logs.drug_id = drugs.id
        WHERE stock_in_logs.id = ?
    """, (log_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def update_stock_in_log(log_id, quantity=None, lot_number=None, expiry_date=None,
                        cost_per_unit=None, supplier=None, received_by=None,
                        notes=None, created_at=None):
    """
    Update a stock-in log retrospectively.
    If quantity changed, adjusts drug stock accordingly and updates audit balances.
    """
    with _db_write_lock:
        conn = get_db()
        cursor = conn.cursor()
        try:
            with conn:
                cursor.execute("SELECT * FROM stock_in_logs WHERE id = ?", (log_id,))
                row = cursor.fetchone()
                if not row:
                    return False, f"ไม่พบรายการรับยาเข้ารหัส #{log_id}"
                old_log = dict(row)
                if old_log.get("is_voided"):
                    return False, "ไม่สามารถแก้ไขรายการรับเข้าที่ถูกยกเลิกไปแล้วได้"
                drug_id = old_log.get("drug_id")

                new_qty = old_log["quantity"]
                if quantity is not None:
                    try:
                        q_val = float(quantity)
                        if q_val <= 0:
                            return False, "จำนวนรับเข้าต้องมากกว่า 0"
                        new_qty = int(q_val) if q_val.is_integer() else q_val
                    except (ValueError, TypeError):
                        return False, "จำนวนรับเข้าต้องเป็นตัวเลขมากกว่า 0"

                # Check drug stock adjustment if quantity changed
                diff = new_qty - old_log["quantity"]
                if diff != 0 and drug_id:
                    cursor.execute("SELECT stock_qty, name FROM drugs WHERE id = ?", (drug_id,))
                    d_row = cursor.fetchone()
                    if d_row:
                        cur_stock_val = float(d_row[0] or 0.0)
                        cur_stock = int(cur_stock_val) if cur_stock_val.is_integer() else cur_stock_val
                        if cur_stock + diff < 0:
                            return False, f"ไม่สามารถลดยอดรับเข้าได้: ยา '{d_row[1]}' ในคลังคงเหลือ {cur_stock} หน่วย ไม่เพียงพอสำหรับการปรับลดยอด {abs(diff)} หน่วย"
                        now_str = get_now_str()
                        cursor.execute("""
                            UPDATE drugs 
                            SET stock_qty = stock_qty + ?, updated_at = ?
                            WHERE id = ?
                        """, (diff, now_str, drug_id))

                new_cost = old_log["cost_per_unit"] if cost_per_unit is None else float(cost_per_unit or 0.0)
                new_total_cost = new_qty * new_cost
                new_lot = old_log["lot_number"] if lot_number is None else str(lot_number).strip()
                new_exp = old_log["expiry_date"] if expiry_date is None else str(expiry_date).strip()
                new_sup = old_log["supplier"] if supplier is None else str(supplier).strip()
                new_rec = old_log["received_by"] if received_by is None else str(received_by).strip()
                new_notes = old_log["notes"] if notes is None else str(notes).strip()
                new_created_at = old_log["created_at"] if created_at is None else str(created_at).strip()

                new_balance_after = old_log["balance_before"] + new_qty

                cursor.execute("""
                    UPDATE stock_in_logs
                    SET quantity = ?,
                        balance_after = ?,
                        cost_per_unit = ?,
                        total_cost = ?,
                        lot_number = ?,
                        expiry_date = ?,
                        supplier = ?,
                        received_by = ?,
                        notes = ?,
                        created_at = ?
                    WHERE id = ?
                """, (
                    new_qty,
                    new_balance_after,
                    new_cost,
                    new_total_cost,
                    new_lot,
                    new_exp,
                    new_sup,
                    new_rec,
                    new_notes,
                    new_created_at,
                    log_id
                ))

                cursor.execute("""
                    SELECT 
                        stock_in_logs.*,
                        COALESCE(drugs.unit, 'หน่วย') AS unit,
                        COALESCE(drugs.stock_qty, 0) AS current_drug_stock
                    FROM stock_in_logs
                    LEFT JOIN drugs ON stock_in_logs.drug_id = drugs.id
                    WHERE stock_in_logs.id = ?
                """, (log_id,))
                updated_row = dict(cursor.fetchone())
                return True, updated_row
        except Exception as e:
            logger.error(f"Error updating stock in log {log_id}: {e}", exc_info=True)
            return False, f"เกิดข้อผิดพลาดในการแก้ไขข้อมูล: {str(e)}"
        finally:
            conn.close()

def void_stock_in_log(log_id, reason="ยกเลิกรายการรับเข้าโดยเจ้าหน้าที่", voided_by="เจ้าหน้าที่"):
    """
    Cancel/void a stock-in receiving log, deduct drug stock, and mark the log as voided (soft cancellation).
    Returns: (success: bool, result_dict or error_message)
    """
    with _db_write_lock:
        conn = get_db()
        cursor = conn.cursor()
        now_str = get_now_str()
        try:
            with conn:
                cursor.execute("SELECT * FROM stock_in_logs WHERE id = ?", (log_id,))
                row = cursor.fetchone()
                if not row:
                    return False, f"ไม่พบรายการรับยาเข้ารหัส #{log_id}"
                old_log = dict(row)
                if old_log.get("is_voided"):
                    return False, f"รายการรับยาเข้ารหัส #{log_id} ถูกยกเลิกไปแล้วเมื่อ {old_log.get('voided_at')}"

                drug_id = old_log.get("drug_id")
                qty = old_log.get("quantity") or 0

                new_stock = None
                if drug_id and qty > 0:
                    cursor.execute("SELECT stock_qty, name FROM drugs WHERE id = ?", (drug_id,))
                    d_row = cursor.fetchone()
                    if d_row:
                        cur_stock_val = float(d_row[0] or 0.0)
                        cur_stock = int(cur_stock_val) if cur_stock_val.is_integer() else cur_stock_val
                        if cur_stock < qty:
                            return False, f"ไม่สามารถยกเลิกรายการรับเข้าได้: ยา '{d_row[1]}' ในคลังคงเหลือเพียง {cur_stock} หน่วย (น้อยกว่ายอดรับเข้า {qty} หน่วย เนื่องจากอาจถูกตัดจ่ายไปแล้ว ระบบบล็อกไว้เพื่อป้องกันสต็อกติดลบ)"
                        
                        if old_log.get("lot_id"):
                            cursor.execute("UPDATE drug_lots SET stock_qty = MAX(0, stock_qty - ?), updated_at = ? WHERE id = ?", (qty, now_str, old_log["lot_id"]))

                        cursor.execute("""
                            UPDATE drugs 
                            SET stock_qty = stock_qty - ?, updated_at = ?
                            WHERE id = ?
                            RETURNING stock_qty
                        """, (qty, now_str, drug_id))
                        res_d = cursor.fetchone()
                        if res_d:
                            new_stock = res_d[0]
                        sync_drug_master_fefo(drug_id, conn=conn)

                cursor.execute("""
                    UPDATE stock_in_logs 
                    SET is_voided = 1, void_reason = ?, voided_by = ?, voided_at = ?
                    WHERE id = ?
                """, (reason.strip(), voided_by.strip(), now_str, log_id))

                old_log["is_voided"] = 1
                old_log["void_reason"] = reason.strip()
                old_log["voided_by"] = voided_by.strip()
                old_log["voided_at"] = now_str
                old_log["new_stock"] = new_stock
                return True, old_log
        except Exception as e:
            logger.error(f"Error voiding stock in log {log_id}: {e}", exc_info=True)
            return False, f"เกิดข้อผิดพลาดในการยกเลิกรายการรับเข้า: {str(e)}"
        finally:
            conn.close()

def delete_stock_in_log(log_id, reason="ยกเลิกรายการรับเข้าโดยเจ้าหน้าที่", voided_by="เจ้าหน้าที่"):
    """Backward compatibility alias: calls void_stock_in_log instead of hard deletion."""
    return void_stock_in_log(log_id, reason=reason, voided_by=voided_by)

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
        cursor.execute("SELECT COALESCE(SUM(quantity), 0) FROM stock_in_logs WHERE created_at LIKE ? AND (stock_in_logs.is_voided IS NULL OR stock_in_logs.is_voided = 0)", (f"{day_str}%",))
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

def _clean_num(x):
    """Round away float noise (0.1 + 0.2 -> 0.3) and return an int when the value is whole."""
    try:
        v = round(float(x), 6)
    except (TypeError, ValueError):
        return x
    return int(v) if v.is_integer() else v


def normalize_ymd(date_str):
    """Return a Gregorian 'YYYY-MM-DD' string for a valid date, or None.

    Accepts Buddhist-era years too (2569-11-19 -> 2026-11-19).
    """
    if not date_str:
        return None
    try:
        parts = str(date_str).strip().split("-")
        if len(parts) != 3:
            return None
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        if y > 2400:
            y -= 543
        return datetime(y, m, d).strftime("%Y-%m-%d")
    except (ValueError, TypeError, OverflowError):
        return None


def get_stock_card_data(drug_id: int, start_date: str = None, end_date: str = None):
    """
    Retrieve unified chronological Stock Card ledger data for a specific drug.
    Combines stock-in (receive), dispensing logs and manual stock adjustments, calculates opening balance
    (ยอดยกมา), running balance, and details formatted for the official hospital ledger card.
    Dispensing rows are valued with the cost recorded at the time of dispensing (falls back to the current cost
    for old rows that pre-date the snapshot).
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

    start_date = normalize_ymd(start_date)
    end_date = normalize_ymd(end_date)
    if start_date and end_date and start_date > end_date:
        start_date, end_date = end_date, start_date
    start_ts = f"{start_date} 00:00:00" if start_date else None
    end_ts = f"{end_date} 23:59:59" if end_date else None

    not_voided = "(is_voided IS NULL OR is_voided = 0)"

    def _fetch(table, extra=""):
        q = f"SELECT * FROM {table} WHERE drug_id = ? {extra}"
        params = [drug_id]
        if start_ts:
            q += " AND created_at >= ?"
            params.append(start_ts)
        if end_ts:
            q += " AND created_at <= ?"
            params.append(end_ts)
        cursor.execute(q, params)
        return [dict(r) for r in cursor.fetchall()]

    stock_in_rows = _fetch("stock_in_logs", f"AND {not_voided}")
    dispensing_rows = _fetch("dispensing_logs", f"AND {not_voided}")
    adjust_rows = _fetch("stock_adjustments")

    total_in_period = sum(r.get("quantity") or 0 for r in stock_in_rows)
    total_out_period = sum(r.get("quantity") or 0 for r in dispensing_rows)
    adj_period = sum(r.get("quantity_delta") or 0 for r in adjust_rows)

    # Movements AFTER the period (needed to walk back from today's stock to the opening balance)
    total_in_after = total_out_after = adj_after = 0
    if end_ts:
        def _after(table, col, extra=""):
            cursor.execute(f"SELECT COALESCE(SUM({col}), 0) FROM {table} WHERE drug_id = ? AND created_at > ? {extra}", (drug_id, end_ts))
            return cursor.fetchone()[0] or 0
        total_in_after = _after("stock_in_logs", "quantity", f"AND {not_voided}")
        total_out_after = _after("dispensing_logs", "quantity", f"AND {not_voided}")
        adj_after = _after("stock_adjustments", "quantity_delta")

    current_stock = drug.get("stock_qty", 0) or 0

    # Opening balance = today's stock minus everything that happened in and after the period
    opening_balance = current_stock - (total_in_period - total_out_period + adj_period) - (total_in_after - total_out_after + adj_after)
    if opening_balance < 0:
        opening_balance = 0
    opening_clamped = False
    opening_balance = _clean_num(opening_balance)

    unit_cost = (drug.get("cost") if (drug.get("cost") is not None and drug.get("cost") > 0) else (drug.get("price") or 0.0)) or 0.0

    # 3. Build unified transaction items
    items = []
    for r in stock_in_rows:
        items.append({
            "id": f"in-{r['id']}",
            "type": "RECEIVE",
            "created_at": r["created_at"],
            "qty_in": _clean_num(r["quantity"]),
            "qty_out": None,
            "supplier": r.get("supplier") or "องค์การเภสัชกรรม (GPO)",
            "recipient": "",
            "price": r.get("cost_per_unit") or drug.get("cost") or 0.0,
            "total_price": r.get("total_cost") or ((r.get("cost_per_unit") or 0.0) * r["quantity"]),
            "lot_number": r.get("lot_number") or drug.get("lot_number") or "",
            "expiry_date": r.get("expiry_date") or drug.get("expiry_date") or "",
            "sign": ""
        })

    for r in dispensing_rows:
        row_cost = r.get("unit_cost")
        if row_cost is None or row_cost <= 0:
            row_cost = drug.get("cost") or drug.get("price") or 0.0
        items.append({
            "id": f"out-{r['id']}",
            "type": "DISPENSE",
            "created_at": r["created_at"],
            "qty_in": None,
            "qty_out": _clean_num(r["quantity"]),
            "supplier": "",
            "recipient": r.get("patient_name") or r.get("notes") or "ผู้ป่วยนอก / ห้องยา",
            "price": row_cost,
            "total_price": row_cost * r["quantity"],
            "lot_number": r.get("lot_number") or drug.get("lot_number") or "",
            "expiry_date": r.get("expiry_date") or drug.get("expiry_date") or "",
            "sign": ""
        })

    for r in adjust_rows:
        delta = r.get("quantity_delta") or 0
        items.append({
            "id": f"adj-{r['id']}",
            "type": "ADJUST",
            "created_at": r["created_at"],
            "qty_in": _clean_num(delta) if delta > 0 else None,
            "qty_out": _clean_num(-delta) if delta < 0 else None,
            "supplier": "",
            "recipient": r.get("reason") or "ปรับยอดล็อต",
            "price": drug.get("cost") or drug.get("price") or 0.0,
            "total_price": abs(delta) * (drug.get("cost") or drug.get("price") or 0.0),
            "lot_number": r.get("lot_number") or "",
            "expiry_date": "",
            "sign": ""
        })

    # Chronological order; inside the same second: receive -> adjust -> dispense (never shows a false negative balance)
    order = {"RECEIVE": 0, "ADJUST": 1, "DISPENSE": 2}
    items.sort(key=lambda x: (x["created_at"], order.get(x["type"], 3)))

    def format_balance_val(val):
        if val is None or val == "":
            return "-"
        try:
            fval = float(val)
            if fval.is_integer():
                return f"{int(fval):,}"
            return f"{fval:,.2f}"
        except (ValueError, TypeError):
            return str(val)

    running_balance = opening_balance
    for item in items:
        running_balance = _clean_num(running_balance + (item["qty_in"] or 0) - (item["qty_out"] or 0))
        item["balance"] = running_balance
        item["balance_value"] = running_balance * (item["price"] or unit_cost)
        item["balance_value_formatted"] = format_balance_val(item["balance_value"])

    opening_value = opening_balance * unit_cost
    opening_value_formatted = format_balance_val(opening_value)

    # Quantities were computed in the drug's base unit (tablets). A drug with a pack size (100 tablets = 1 box)
    # is shown in packs; values (baht) are unaffected because they were already computed from the base unit.
    pack_size = drug.get("pack_size") or 0
    pack_unit = ""
    pack_note = ""
    if pack_size and pack_size > 1:
        pack_unit = (drug.get("pack_unit") or "กล่อง").strip() or "กล่อง"
        base_unit = (drug.get("unit") or "หน่วย").strip() or "หน่วย"
        if base_unit == pack_unit:
            d_form = (drug.get("dosage_form") or "").lower()
            base_unit = "เม็ด" if ("tab" in d_form or "เม็ด" in d_form) else ("แคปซูล" if "cap" in d_form else "หน่วย")

        def _to_pack(x):
            return None if x is None else _clean_num(round(float(x) / pack_size, 4))

        for item in items:
            item["qty_in"] = _to_pack(item["qty_in"])
            item["qty_out"] = _to_pack(item["qty_out"])
            item["balance"] = _to_pack(item["balance"])

            # Recalculate balance_value accurately for pack ledger
            # Ensure price per pack is used (e.g. 165 baht per box)
            raw_p = float(item.get("price") or unit_cost or 0.0)
            pack_price = raw_p if raw_p >= (unit_cost * pack_size * 0.5) else (raw_p * pack_size)
            item["price"] = pack_price
            if item["balance"] is not None:
                item["balance_value"] = _clean_num(round(item["balance"] * pack_price, 2))
                item["balance_value_formatted"] = format_balance_val(item["balance_value"])

        opening_balance = _to_pack(opening_balance)
        running_balance = _to_pack(running_balance)
        total_in_period = _to_pack(total_in_period)
        total_out_period = _to_pack(total_out_period)

        pack_unit_cost = unit_cost if unit_cost >= (unit_cost * pack_size * 0.5) else (unit_cost * pack_size)
        opening_value = _clean_num(round((opening_balance or 0) * pack_unit_cost, 2))
        opening_value_formatted = format_balance_val(opening_value)
        pack_note = f"หน่วยนับในบัญชี: {pack_unit} (1 {pack_unit} = {_clean_num(pack_size)} {base_unit})"

    conn.close()
    return {
        "pack_size": pack_size or None,
        "pack_unit": pack_unit,
        "pack_note": pack_note,
        "drug": drug,
        "opening_fiscal_year": (drug.get("opening_fiscal_year") or "").strip(),
        "opening_balance": opening_balance,
        "opening_value": opening_value,
        "opening_value_formatted": opening_value_formatted,
        "opening_clamped": opening_clamped,
        "unit_cost": unit_cost,
        "closing_balance": running_balance,
        "total_in": _clean_num(total_in_period),
        "total_out": _clean_num(total_out_period),
        "transactions": items,
        "start_date": start_date or "",
        "end_date": end_date or ""
    }


def get_daily_requisition_available_dates():
    """Dates that have (non-cancelled) dispensing or stock-in records, newest first."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT dt, SUM(cnt) as count FROM (
            SELECT substr(created_at, 1, 10) as dt, count(*) as cnt FROM dispensing_logs
              WHERE (is_voided IS NULL OR is_voided = 0) GROUP BY dt
            UNION ALL
            SELECT substr(created_at, 1, 10) as dt, count(*) as cnt FROM stock_in_logs
              WHERE (is_voided IS NULL OR is_voided = 0) GROUP BY dt
        )
        WHERE dt IS NOT NULL AND dt != ''
        GROUP BY dt
        ORDER BY dt DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [{"date": r["dt"], "count": r["count"]} for r in rows if r["dt"]]


def get_daily_requisition_data(date_str: str = None):
    """
    Aggregated daily requisition data for 'ใบเบิกเวชภัณฑ์ยาและเวชภัณฑ์มิใช่ยา'.
    Uses only real, non-cancelled records of the chosen day. 'คงเหลือ' is the balance recorded at the end of
    that day (balance_after of the last movement), not today's stock.
    """
    date_str = normalize_ymd(date_str) or datetime.now(BANGKOK_TZ).strftime("%Y-%m-%d")

    thai_months = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
                   "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
    thai_months_short = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                         "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    y, m, d = (int(p) for p in date_str.split("-"))
    day_str, month_name, month_short, year_be = str(d), thai_months[m], thai_months_short[m], str(y + 543)

    conn = get_db()
    cursor = conn.cursor()
    start_ts = f"{date_str} 00:00:00"
    end_ts = f"{date_str} 23:59:59"

    cursor.execute("""
        SELECT stock_in_logs.id, stock_in_logs.drug_id,
               COALESCE(drugs.name, stock_in_logs.drug_name, 'เวชภัณฑ์ไม่ระบุชื่อ') AS drug_name,
               COALESCE(drugs.generic_name, '') AS generic_name,
               COALESCE(drugs.unit, 'หน่วย') AS unit,
               stock_in_logs.quantity, stock_in_logs.balance_after, stock_in_logs.created_at
        FROM stock_in_logs
        LEFT JOIN drugs ON stock_in_logs.drug_id = drugs.id
        WHERE stock_in_logs.created_at >= ? AND stock_in_logs.created_at <= ?
          AND (stock_in_logs.is_voided IS NULL OR stock_in_logs.is_voided = 0)
        ORDER BY stock_in_logs.created_at ASC, stock_in_logs.id ASC
    """, (start_ts, end_ts))
    raw_stock_ins = [dict(r) for r in cursor.fetchall()]

    cursor.execute("""
        SELECT dispensing_logs.id, dispensing_logs.drug_id,
               COALESCE(drugs.name, dispensing_logs.drug_name, 'เวชภัณฑ์ไม่ระบุชื่อ') AS drug_name,
               COALESCE(drugs.generic_name, '') AS generic_name,
               COALESCE(drugs.unit, 'หน่วย') AS unit,
               dispensing_logs.quantity, dispensing_logs.balance_after, dispensing_logs.created_at
        FROM dispensing_logs
        LEFT JOIN drugs ON dispensing_logs.drug_id = drugs.id
        WHERE (dispensing_logs.is_voided IS NULL OR dispensing_logs.is_voided = 0)
          AND dispensing_logs.created_at >= ? AND dispensing_logs.created_at <= ?
        ORDER BY dispensing_logs.created_at ASC, dispensing_logs.id ASC
    """, (start_ts, end_ts))
    raw_disp = [dict(r) for r in cursor.fetchall()]
    conn.close()

    items_map = {}

    def _bucket(row):
        name = (row.get("generic_name") or row.get("drug_name") or "").strip()
        key = row["drug_id"] if row["drug_id"] else name
        if key not in items_map:
            items_map[key] = {
                "drug_id": row["drug_id"],
                "name": row["generic_name"] or row["drug_name"],
                "unit": row["unit"] or "หน่วย",
                "qty_requested": "",
                "qty_dispensed": "",
                "remaining_stock": "",
                "notes": "",
                "_last": ("", 0),
            }
        return items_map[key]

    def _touch(it, row):
        # remember the balance recorded by the latest movement of the day
        marker = (row["created_at"], row["id"])
        if row.get("balance_after") is not None and marker >= it["_last"]:
            it["remaining_stock"] = _clean_num(row["balance_after"])
            it["_last"] = marker

    for sin in raw_stock_ins:
        it = _bucket(sin)
        it["qty_requested"] = _clean_num((it["qty_requested"] or 0) + (sin.get("quantity") or 0))
        _touch(it, sin)

    for log in raw_disp:
        it = _bucket(log)
        it["qty_dispensed"] = _clean_num((it["qty_dispensed"] or 0) + (log.get("quantity") or 0))
        _touch(it, log)

    items = list(items_map.values())
    for it in items:
        it.pop("_last", None)

    tot_val = sum(float(it["qty_dispensed"] or 0) for it in items)
    total_dispensed = _clean_num(tot_val)

    return {
        "date": date_str,
        "day": day_str,
        "month_thai": month_name,
        "month_short": month_short,
        "year_be": year_be,
        "items": items,
        "total_items": len(items),
        "total_dispensed_qty": total_dispensed,
        "hospital_name": Config.ORG_NAME,
        "requester_name": Config.ORG_REQUESTER_NAME,
        "requester_title": Config.ORG_REQUESTER_TITLE,
        "dispenser_name": Config.ORG_DISPENSER_NAME,
        "dispenser_title": Config.ORG_DISPENSER_TITLE,
        "authorizer_name": Config.ORG_AUTHORIZER_NAME,
        "authorizer_title": Config.ORG_AUTHORIZER_TITLE,
        "receiver_name": Config.ORG_RECEIVER_NAME,
        "receiver_title": Config.ORG_RECEIVER_TITLE,
        "has_records": len(items) > 0
    }


# ─────────────────────────────────────────────────────────────
# Category Master Management (CRUD)
# ─────────────────────────────────────────────────────────────

def get_categories():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT c.id, c.name, c.color, COUNT(d.id) as drug_count
        FROM categories c
        LEFT JOIN drugs d ON d.category = c.name
        GROUP BY c.id, c.name, c.color
        ORDER BY c.id ASC
    """)
    cats = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return cats

def add_category(name, color="teal"):
    name = (name or "").strip()
    if not name:
        return False, "ชื่อหมวดหมู่ต้องไม่ว่างเปล่า"
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO categories (name, color) VALUES (?, ?)", (name, color or "teal"))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return True, {"id": new_id, "name": name, "color": color or "teal", "drug_count": 0}
    except sqlite3.IntegrityError:
        conn.close()
        return False, "มีหมวดหมู่นี้อยู่ในระบบแล้ว"
    except Exception as e:
        conn.close()
        return False, str(e)

def update_category(cat_id, new_name, color=None):
    new_name = (new_name or "").strip()
    if not new_name:
        return False, "ชื่อหมวดหมู่ต้องไม่ว่างเปล่า"
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT name, color FROM categories WHERE id = ?", (cat_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return False, "ไม่พบหมวดหมู่นี้"
    old_name = row["name"]
    target_color = color if color is not None else row["color"]
    try:
        cursor.execute("UPDATE categories SET name = ?, color = ? WHERE id = ?", (new_name, target_color, cat_id))
        if old_name != new_name:
            cursor.execute("UPDATE drugs SET category = ? WHERE category = ?", (new_name, old_name))
        conn.commit()
        conn.close()
        return True, {"id": cat_id, "name": new_name, "color": target_color}
    except sqlite3.IntegrityError:
        conn.close()
        return False, "ชื่อหมวดหมู่นี้ซ้ำกับที่มีอยู่แล้ว"
    except Exception as e:
        conn.close()
        return False, str(e)

def delete_category(cat_id, fallback_name="ทั่วไป"):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM categories WHERE id = ?", (cat_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return False, "ไม่พบหมวดหมู่นี้"
    old_name = row["name"]
    cursor.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
    # Reassign affected drugs to fallback category
    cursor.execute("UPDATE drugs SET category = ? WHERE category = ?", (fallback_name, old_name))
    conn.commit()
    conn.close()
    return True, f"ลบหมวดหมู่ {old_name} สำเร็จ"

def perform_db_backup(backup_type='auto'):
    """
    Safely backup the SQLite database using the online backup API.
    Does not lock reads/writes and creates a standalone .db copy.
    """
    backup_dir = Path("backups")
    backup_dir.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now(BANGKOK_TZ).strftime("%Y%m%d_%H%M%S")
    backup_filename = f"pharmacy_{backup_type}_{timestamp}.db"
    backup_path = backup_dir / backup_filename
    
    try:
        source_conn = get_db()
        dest_conn = sqlite3.connect(str(backup_path))
        with dest_conn:
            source_conn.backup(dest_conn)
        dest_conn.close()
        source_conn.close()
        
        # Cleanup old backups (keep last 14)
        all_backups = sorted(list(backup_dir.glob("pharmacy_*.db")), key=lambda p: p.stat().st_mtime, reverse=True)
        if len(all_backups) > 14:
            for old_bk in all_backups[14:]:
                try:
                    old_bk.unlink()
                except Exception:
                    pass
                    
        return {
            "success": True,
            "filename": backup_filename,
            "path": str(backup_path),
            "size_bytes": backup_path.stat().st_size,
            "created_at": get_now_str()
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def list_db_backups():
    """
    List all available database backup files with size and creation dates.
    """
    backup_dir = Path("backups")
    if not backup_dir.exists():
        return []
    
    backups = []
    for f in sorted(backup_dir.glob("pharmacy_*.db"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = f.stat()
        dt_str = datetime.fromtimestamp(stat.st_mtime, BANGKOK_TZ).strftime("%Y-%m-%d %H:%M:%S")
        size_kb = round(stat.st_size / 1024, 1)
        backups.append({
            "filename": f.name,
            "size_kb": size_kb,
            "created_at": dt_str
        })
    return backups

# Initialize on module import
init_db()

# Auto-backup check on startup (once a day)
try:
    today_prefix = datetime.now(BANGKOK_TZ).strftime("pharmacy_auto_%Y%m%d")
    backup_dir = Path("backups")
    has_today = any(f.name.startswith(today_prefix) for f in backup_dir.glob("pharmacy_auto_*.db")) if backup_dir.exists() else False
    if not has_today:
        perform_db_backup('auto')
except Exception:
    pass
