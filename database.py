"""
Pharmacy Database Layer (SQLite)
Manages drug master, dispensing logs, categories, and audit trail.
"""

import sqlite3
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
from config import Config

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
                FOREIGN KEY (drug_id) REFERENCES drugs (id) ON DELETE SET NULL
            )
        """)

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
                drug_id INTEGER NOT NULL,
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
                FOREIGN KEY (drug_id) REFERENCES drugs (id) ON DELETE CASCADE
            )
        """)

        # Indexes for fast search
        conn.execute("CREATE INDEX IF NOT EXISTS idx_drugs_name ON drugs(name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_drugs_code ON drugs(code)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_created ON dispensing_logs(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_subscribers_target ON line_subscribers(target_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_stock_in_created ON stock_in_logs(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_stock_in_drug ON stock_in_logs(drug_id)")
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

# ─────────────────────────────────────────────────────────────
# Drug Expiry & Inventory Query Operations
# ─────────────────────────────────────────────────────────────

def parse_expiry_date(date_str):
    """Parse expiry date string into datetime.date object."""
    if not date_str:
        return None
    cleaned = str(date_str).strip()
    if not cleaned:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(cleaned, fmt).date()
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
        query += " AND (name LIKE ? OR code LIKE ? OR generic_name LIKE ?)"
        q = f"%{search_query.strip()}%"
        params.extend([q, q, q])

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

    # 3. Substring match
    cursor.execute("SELECT * FROM drugs WHERE LOWER(name) LIKE ? OR LOWER(generic_name) LIKE ? OR LOWER(code) LIKE ? OR LOWER(instructions) LIKE ?", (f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"))
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
    """Delete drug from inventory."""
    conn = get_db()
    with conn:
        conn.execute("DELETE FROM drugs WHERE id = ?", (drug_id,))
    conn.close()
    return True

# ─────────────────────────────────────────────────────────────
# Stock Dispensing & Deduction Flow (Atomic Transaction)
# ─────────────────────────────────────────────────────────────

def deduct_stock(drug_id_or_code, quantity, channel="WEB_MANUAL", dispensed_by="เจ้าหน้าที่", patient_name="", drive_file_id=None, drive_file_link=None, notes=""):
    """
    Atomically deduct stock from a drug and insert a dispensing log.
    Returns: (success: bool, result_dict or error_message)
    """
    if quantity <= 0:
        return False, "จำนวนที่ตัดต้องมากกว่า 0"

    conn = get_db()
    cursor = conn.cursor()
    now = get_now_str()

    try:
        with conn:
            # 1. Fetch drug with lock
            if isinstance(drug_id_or_code, int) or (isinstance(drug_id_or_code, str) and drug_id_or_code.isdigit()):
                cursor.execute("SELECT * FROM drugs WHERE id = ?", (int(drug_id_or_code),))
            else:
                cursor.execute("SELECT * FROM drugs WHERE UPPER(code) = UPPER(?) OR LOWER(name) = LOWER(?)", (str(drug_id_or_code).strip(), str(drug_id_or_code).strip()))

            row = cursor.fetchone()
            if not row:
                return False, f"ไม่พบข้อมูลยา: {drug_id_or_code}"

            drug = dict(row)
            current_stock = drug["stock_qty"]

            if current_stock < quantity:
                return False, f"สต็อกไม่เพียงพอ! มียา '{drug['name']}' เหลืออยู่เพียง {current_stock} {drug['unit']} (ต้องการตัด {quantity} {drug['unit']})"

            new_stock = current_stock - quantity

            # 2. Update stock
            cursor.execute("UPDATE drugs SET stock_qty = ?, updated_at = ? WHERE id = ?", (new_stock, now, drug["id"]))

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
                quantity,
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

            result = {
                "log_id": log_id,
                "drug_id": drug["id"],
                "drug_code": drug["code"],
                "drug_name": drug["name"],
                "quantity": quantity,
                "unit": drug["unit"],
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
            COALESCE(drugs.generic_name, '') AS generic_name
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
        query += " AND dispensing_logs.channel = ?"
        params.append(channel_filter)

    query += " ORDER BY dispensing_logs.id DESC LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

def get_dashboard_stats():
    """Summary metrics for the clinical dashboard."""
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM drugs")
    total_drugs = cursor.fetchone()[0]

    cursor.execute("SELECT SUM(stock_qty) FROM drugs")
    total_units = cursor.fetchone()[0] or 0

    cursor.execute("SELECT COUNT(*) FROM drugs WHERE stock_qty <= min_threshold")
    low_stock_count = cursor.fetchone()[0]

    # Today's dispensing count
    today_str = datetime.now(BANGKOK_TZ).strftime("%Y-%m-%d")
    cursor.execute("SELECT COUNT(*), SUM(quantity) FROM dispensing_logs WHERE created_at LIKE ?", (f"{today_str}%",))
    disp_count_row = cursor.fetchone()
    today_dispense_count = disp_count_row[0] or 0
    today_units_dispensed = disp_count_row[1] or 0

    conn.close()

    # Expiring soon (within 60 days or already expired)
    expiring_drugs = get_expiring_drugs(days=60)
    expiring_soon_count = len(expiring_drugs)

    return {
        "total_drugs": total_drugs,
        "total_units": total_units,
        "low_stock_count": low_stock_count,
        "today_dispense_count": today_dispense_count,
        "today_units_dispensed": today_units_dispensed,
        "expiring_soon_count": expiring_soon_count,
        "expiring_items": expiring_drugs[:5]
    }

# ─────────────────────────────────────────────────────────────
# Stock In / Receiving & Lot Management Flow
# ─────────────────────────────────────────────────────────────

def stock_in(drug_id_or_code, quantity, lot_number="", cost_per_unit=None, expiry_date=None, supplier="องค์การเภสัชกรรม (GPO)", received_by="เภสัชกร/เจ้าหน้าที่", notes=""):
    """
    Atomically add received stock into inventory and record a Stock In log.
    Updates lot_number, expiry_date, cost, and stock_qty on the drug record.
    Returns: (success: bool, result_dict or error_message)
    """
    try:
        qty_int = int(quantity)
    except (ValueError, TypeError):
        return False, "จำนวนที่รับเข้าต้องเป็นตัวเลขจำนวนเต็มบวก"

    if qty_int <= 0:
        return False, "จำนวนที่รับเข้าต้องมากกว่า 0"

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
            current_stock = drug["stock_qty"]
            new_stock = current_stock + qty_int

            # Determine cost
            try:
                unit_cost = float(cost_per_unit) if cost_per_unit is not None and str(cost_per_unit).strip() != "" else float(drug.get("cost") or 0.0)
            except (ValueError, TypeError):
                unit_cost = float(drug.get("cost") or 0.0)
            total_cost = round(unit_cost * qty_int, 2)

            # Determine expiry date and lot
            new_expiry = expiry_date.strip() if expiry_date and str(expiry_date).strip() else (drug.get("expiry_date") or "")
            lot_no = lot_number.strip() if lot_number and str(lot_number).strip() else (drug.get("lot_number") or "")

            # 2. Update drugs table
            cursor.execute("""
                UPDATE drugs SET 
                    stock_qty = ?,
                    cost = ?,
                    expiry_date = ?,
                    lot_number = ?,
                    updated_at = ?
                WHERE id = ?
            """, (new_stock, unit_cost, new_expiry, lot_no, now, drug["id"]))

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
                new_expiry,
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
                "expiry_date": new_expiry,
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
        cursor.execute("SELECT COALESCE(SUM(quantity), 0) FROM dispensing_logs WHERE created_at LIKE ?", (f"{day_str}%",))
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

# Initialize on module import
init_db()
