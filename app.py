"""
🏥 Pharmacy Stock Management & Dispensing System
Flask Application Entry Point
"""

import sys
import os
import json
import logging
import secrets
import urllib.parse
import urllib.request
from pathlib import Path
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_from_directory, redirect, send_file, make_response
from io import BytesIO
from config import Config
import database
from google_sync import google_sync
from line_service import line_bot
from ocr_service import parse_drug_from_image

# Safe UTF-8 on Windows
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

app = Flask(
    __name__,
    template_folder=str(Path(__file__).parent / "templates"),
    static_folder=str(Path(__file__).parent / "static")
)
app.config.from_object(Config)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.jinja_env.auto_reload = True

logger = logging.getLogger("pharmacy_app")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

@app.after_request
def disable_cache_for_dev(response):
    # Skip no-cache for file downloads — browsers refuse to save attachments with no-store
    if request.path.startswith("/api/export"):
        return response
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ─────────────────────────────────────────────────────────────
# HTML Views
# ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", base_url=Config.BASE_URL)

@app.route("/scanner")
def mobile_scanner():
    return render_template("index.html", initial_view="scanner", base_url=Config.BASE_URL)

@app.route("/manifest.json")
def manifest():
    return send_from_directory(str(Path(__file__).parent / "static"), "manifest.json", mimetype="application/manifest+json")

@app.route("/sw.js")
def service_worker():
    response = make_response(send_from_directory(str(Path(__file__).parent / "static"), "sw.js", mimetype="application/javascript"))
    response.headers["Service-Worker-Allowed"] = "/"
    return response

@app.route("/download/apk")
@app.route("/download/app.apk")
def download_apk():
    apk_path = Path(__file__).parent / "static" / "downloads" / "PharmaCore.apk"
    if apk_path.exists():
        return send_file(str(apk_path), as_attachment=True, download_name="PharmaCore.apk", mimetype="application/vnd.android.package-archive")
    # Redirect to mobile install view if apk binary is not physically compiled yet
    return redirect("/?install=apk")


# ─────────────────────────────────────────────────────────────
# Drug Inventory API (CRUD & Search)
# ─────────────────────────────────────────────────────────────

@app.route("/api/drugs", methods=["GET"])
def list_drugs():
    search = request.args.get("q", "").strip()
    category = request.args.get("category", "").strip()
    low_stock = request.args.get("low_stock") == "1"
    
    expiring_param = request.args.get("expiring_days")
    if expiring_param:
        try:
            expiring_days = int(expiring_param)
        except ValueError:
            expiring_days = 60
    elif request.args.get("expiring") == "1":
        expiring_days = Config.EXPIRY_ALERT_DAYS or 60
    else:
        expiring_days = None

    drugs = database.get_all_drugs(search_query=search, category=category, low_stock_only=low_stock, expiring_soon_days=expiring_days)
    return jsonify({"ok": True, "drugs": drugs, "count": len(drugs)})

@app.route("/api/drugs/expiring", methods=["GET"])
def list_expiring_drugs():
    days = int(request.args.get("days", Config.EXPIRY_ALERT_DAYS or 60))
    drugs = database.get_expiring_drugs(days=days)
    return jsonify({"ok": True, "days": days, "drugs": drugs, "count": len(drugs)})

@app.route("/api/drugs/<int:drug_id>", methods=["GET"])
def get_drug(drug_id):
    drug = database.get_drug_by_id(drug_id)
    if not drug:
        return jsonify({"ok": False, "error": "ไม่พบข้อมูลยา"}), 404
    return jsonify({"ok": True, "drug": drug})

@app.route("/api/drugs/scan-lookup", methods=["GET"])
def scan_lookup():
    code = request.args.get("code", "").strip()
    if not code:
        return jsonify({"ok": False, "error": "กรุณาระบุรหัสที่สแกน"}), 400

    clean_code = code
    if "http://" in clean_code or "https://" in clean_code:
        try:
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(clean_code)
            qs = parse_qs(parsed.query)
            extracted = qs.get("scan", [None])[0] or qs.get("code", [None])[0] or qs.get("dispense", [None])[0]
            if extracted:
                clean_code = extracted.strip()
            else:
                parts = [p for p in parsed.path.split('/') if p]
                if parts:
                    clean_code = parts[-1].strip()
        except Exception:
            pass

    clean_code = clean_code.replace("PHARM:", "").strip()
    drug = database.get_drug_by_code(clean_code) or database.find_drug_by_name_or_alias(clean_code)
    
    if drug:
        return jsonify({"ok": True, "found": True, "drug": drug})
    else:
        return jsonify({"ok": True, "found": False, "scanned_code": code, "clean_code": clean_code})

def trigger_bg_sheet_sync():
    """Run Google Sheet sync in daemon thread so API responses are lightning fast."""
    import threading
    def _run():
        try:
            google_sync.sync_all_drugs_to_sheet(database.get_all_drugs())
        except Exception as e:
            logger.warning(f"Background sheet sync error: {e}")
    threading.Thread(target=_run, daemon=True).start()

@app.route("/api/drugs", methods=["POST"])
def create_drug():
    data = request.json or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "กรุณาระบุชื่อยา"}), 400

    new_drug = database.add_drug(data)
    trigger_bg_sheet_sync()

    # LINE Bot New Drug Notification
    import threading
    def _bg_notify_new_drug(d):
        try:
            from line_service import line_bot
            line_bot.send_new_drug_notification(d)
        except Exception as err:
            logger.error(f"Error sending LINE new drug notification: {err}")
    threading.Thread(target=_bg_notify_new_drug, args=(new_drug,), daemon=True).start()

    return jsonify({"ok": True, "drug": new_drug, "message": "เพิ่มข้อมูลยาในคลังเรียบร้อยแล้ว"})

@app.route("/api/drugs/<int:drug_id>", methods=["PUT"])
def edit_drug(drug_id):
    data = request.json or {}
    updated = database.update_drug(drug_id, data)
    if not updated:
        return jsonify({"ok": False, "error": "ไม่พบข้อมูลยาที่ต้องการแก้ไข"}), 404

    trigger_bg_sheet_sync()
    return jsonify({"ok": True, "drug": updated, "message": "แก้ไขข้อมูลยาเรียบร้อยแล้ว"})

@app.route("/api/drugs/<int:drug_id>", methods=["DELETE"])
def remove_drug(drug_id):
    database.delete_drug(drug_id)
    trigger_bg_sheet_sync()
    return jsonify({"ok": True, "message": "ลบยาออกจากคลังเรียบร้อยแล้ว"})

# ─────────────────────────────────────────────────────────────
# Stock Dispensing & Deduction API
# ─────────────────────────────────────────────────────────────

@app.route("/api/dispense", methods=["POST"])
def dispense_stock():
    """
    Deduct stock via Web UI (Manual or QR Scan).
    Payload: {drug_id: int, quantity: int, channel: str, dispensed_by: str, patient_name: str, notes: str}
    """
    data = request.json or {}
    drug_id = data.get("drug_id")
    quantity = int(data.get("quantity") or 1)
    channel = data.get("channel") or "WEB_MANUAL"
    dispensed_by = data.get("dispensed_by") or "เภสัชกร/เจ้าหน้าที่"
    patient_name = data.get("patient_name") or ""
    notes = data.get("notes") or ""

    if not drug_id:
        return jsonify({"ok": False, "error": "กรุณาระบุรหัสยาที่ต้องการตัดสต็อก"}), 400

    success, result = database.deduct_stock(
        drug_id,
        quantity,
        channel=channel,
        dispensed_by=dispensed_by,
        patient_name=patient_name,
        notes=notes
    )

    if not success:
        return jsonify({"ok": False, "error": result}), 400

    # Sync to Google Sheets
    try:
        google_sync.append_dispensing_log(result)
        google_sync.sync_all_drugs_to_sheet(database.get_all_drugs())
    except Exception as e:
        logger.error(f"Error syncing to sheet after dispense: {e}")

    # LINE Bot Stock Movement Notification
    import threading
    def _bg_notify_dispense(res):
        try:
            from line_service import line_bot
            line_bot.send_dispense_notification(res)
        except Exception as err:
            logger.error(f"Error sending LINE dispense notification: {err}")
    threading.Thread(target=_bg_notify_dispense, args=(result,), daemon=True).start()

    return jsonify({
        "ok": True,
        "result": result,
        "message": f"ตัดสต็อก '{result['drug_name']}' สำเร็จ - คงเหลือ {result['balance_after']} {result['unit']}"
    })

@app.route("/api/dispense/logs", methods=["GET"])
def list_logs():
    limit = int(request.args.get("limit", 100))
    date_filter = request.args.get("date")
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    channel = request.args.get("channel")
    logs = database.get_dispensing_logs(
        limit=limit,
        date_filter=date_filter,
        channel_filter=channel,
        start_date=start_date,
        end_date=end_date
    )
    return jsonify({"ok": True, "logs": logs, "count": len(logs)})

# ─────────────────────────────────────────────────────────────
# Stock In & Receiving API (Batch & Lot Management)
# ─────────────────────────────────────────────────────────────

@app.route("/api/stock-in", methods=["POST"])
def stock_in_endpoint():
    data = request.json or {}
    drug_id = data.get("drug_id")
    drug_code = data.get("drug_code")
    target = drug_id or drug_code

    if not target:
        return jsonify({"ok": False, "error": "กรุณาระบุรหัสยาหรือเลือกรายการยา"}), 400

    try:
        quantity = int(data.get("quantity") or 0)
    except (ValueError, TypeError):
        return jsonify({"ok": False, "error": "จำนวนรับเข้าต้องเป็นตัวเลข"}), 400

    if quantity <= 0:
        return jsonify({"ok": False, "error": "จำนวนรับเข้าต้องมากกว่า 0"}), 400

    lot_number = (data.get("lot_number") or "").strip()
    cost_per_unit = data.get("cost_per_unit")
    expiry_date = (data.get("expiry_date") or "").strip()
    supplier = (data.get("supplier") or "องค์การเภสัชกรรม (GPO)").strip()
    received_by = (data.get("received_by") or "เภสัชกร/เจ้าหน้าที่").strip()
    notes = (data.get("notes") or "").strip()

    success, result = database.stock_in(
        drug_id_or_code=target,
        quantity=quantity,
        lot_number=lot_number,
        cost_per_unit=cost_per_unit,
        expiry_date=expiry_date,
        supplier=supplier,
        received_by=received_by,
        notes=notes
    )

    if not success:
        return jsonify({"ok": False, "error": result}), 400

    # Sync inventory to Google Sheets in background
    trigger_bg_sheet_sync()

    # LINE Bot Stock In Notification
    import threading
    def _bg_notify_stock_in(res):
        try:
            from line_service import line_bot
            line_bot.send_stock_in_notification(res)
        except Exception as err:
            logger.error(f"Error sending LINE stock in notification: {err}")
    threading.Thread(target=_bg_notify_stock_in, args=(result,), daemon=True).start()

    return jsonify({
        "ok": True,
        "result": result,
        "message": f"รับเข้า '{result['drug_name']}' จำนวน {result['quantity']} {result['unit']} สำเร็จ (คงเหลือใหม่ {result['balance_after']} {result['unit']})"
    })

@app.route("/api/stock-in/logs", methods=["GET"])
def list_stock_in_logs():
    limit = int(request.args.get("limit", 100))
    date_filter = request.args.get("date")
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    drug_id = request.args.get("drug_id")
    logs = database.get_stock_in_logs(
        limit=limit,
        drug_id=drug_id,
        date_filter=date_filter,
        start_date=start_date,
        end_date=end_date
    )
    return jsonify({"ok": True, "logs": logs, "count": len(logs)})

@app.route("/api/analytics/summary", methods=["GET"])
def analytics_summary():
    summary = database.get_analytics_summary()
    return jsonify({"ok": True, "analytics": summary})

@app.route("/api/dashboard/stats", methods=["GET"])
def dashboard_stats():
    stats = database.get_dashboard_stats()
    stats["google_sheet_connected"] = google_sync.is_connected
    stats["google_spreadsheet_id"] = google_sync.spreadsheet_id or "Not Configured"
    return jsonify({"ok": True, "stats": stats})

# ─────────────────────────────────────────────────────────────
# Google Drive & Sheets Connection Settings API
# ─────────────────────────────────────────────────────────────

@app.route("/api/google/config", methods=["GET"])
def get_google_config():
    info = google_sync.get_connection_info()
    return jsonify({"ok": True, "config": info})

@app.route("/api/google/config", methods=["POST"])
def update_google_config():
    data = request.json or {}
    sheet_input = data.get("spreadsheet_id")
    drive_input = data.get("drive_folder_id")
    sa_input = data.get("service_account_json")

    info = google_sync.update_and_reconnect(sheet_input, drive_input, sa_input)
    if info.get("is_connected") and info.get("spreadsheet_id"):
        try:
            google_sync.ensure_pharmacy_spreadsheet()
            google_sync.sync_all_drugs_to_sheet(database.get_all_drugs())
        except Exception as e:
            logger.warning(f"Sync after config update error: {e}")

    return jsonify({"ok": True, "config": info, "message": "อัปเดตการเชื่อมต่อ Google Drive & Sheets เรียบร้อยแล้ว"})

@app.route("/api/google/auto-create-sheet", methods=["POST"])
def auto_create_google_sheet():
    sheet_id, err = google_sync.ensure_pharmacy_spreadsheet()
    if err:
        return jsonify({"ok": False, "error": err}), 400

    try:
        google_sync.sync_all_drugs_to_sheet(database.get_all_drugs())
    except Exception:
        pass

    return jsonify({"ok": True, "config": google_sync.get_connection_info(), "message": "สร้าง Google Sheet สำหรับคลังยาสำเร็จแล้ว"})

@app.route("/api/google/disconnect", methods=["POST"])
def disconnect_google_endpoint():
    google_sync.disconnect_google()
    return jsonify({"ok": True, "message": "ตัดการเชื่อมต่อ Google สำเร็จแล้ว"})

# ─────────────────────────────────────────────────────────────
# Google OAuth2 Automatic Authorization (Drive & Sheets Auto-Create)
# ─────────────────────────────────────────────────────────────

def _determine_redirect_uri():
    cf_ray = request.headers.get("cf-ray")
    cf_host = request.headers.get("x-forwarded-host") or request.host or ""
    
    # If accessing via public domain or Cloudflare tunnel
    if cf_ray or "openchat.sbs" in cf_host:
        return "https://openchat.sbs/api/auth/google/callback"
    
    # If direct local access
    if "localhost" in cf_host or "127.0.0.1" in cf_host:
        return "http://localhost:5005/api/auth/google/callback"

    return Config.OAUTH2_REDIRECT_URI or "https://openchat.sbs/api/auth/google/callback"

@app.route("/api/auth/google/login")
def google_oauth_login():
    """Start Google OAuth flow to grant Drive & Sheets access automatically."""
    client_id = Config.GOOGLE_OAUTH2_CLIENT_ID
    if not client_id:
        return "Google OAuth2 Client ID not configured", 500

    redirect_uri = _determine_redirect_uri()
    state_token = secrets.token_urlsafe(32)
    database.set_app_setting(f"oauth_state_{state_token}", redirect_uri)

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets",
        "access_type": "offline",
        "prompt": "consent",
        "state": state_token
    }
    auth_url = "https://accounts.google.com/o/oauth2/auth?" + urllib.parse.urlencode(params)
    return redirect(auth_url)

@app.route("/api/auth/google/callback")
def google_oauth_callback():
    """Exchange authorization code for tokens and auto-create Google Drive & Sheet."""
    error = request.args.get("error")
    if error:
        return redirect("/?google_error=" + urllib.parse.quote(error))

    code = request.args.get("code")
    state = request.args.get("state")
    if not code:
        return redirect("/?google_error=no_code")

    saved_redirect_uri = database.get_app_setting(f"oauth_state_{state}") or _determine_redirect_uri()

    try:
        # Exchange code for token with Google
        token_payload = urllib.parse.urlencode({
            "code": code,
            "client_id": Config.GOOGLE_OAUTH2_CLIENT_ID,
            "client_secret": Config.GOOGLE_OAUTH2_CLIENT_SECRET,
            "redirect_uri": saved_redirect_uri,
            "grant_type": "authorization_code"
        }).encode("utf-8")

        req = urllib.request.Request("https://oauth2.googleapis.com/token", data=token_payload, method="POST")
        with urllib.request.urlopen(req) as resp:
            token_res = json.loads(resp.read().decode("utf-8"))

        access_token = token_res.get("access_token")
        refresh_token = token_res.get("refresh_token")

        # Get user email
        userinfo_req = urllib.request.Request(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        with urllib.request.urlopen(userinfo_req) as resp:
            user_info = json.loads(resp.read().decode("utf-8"))
        google_email = user_info.get("email", "unknown@gmail.com")

        # Setup workspace automatically
        ok, res = google_sync.setup_oauth_workspace(google_email, access_token, refresh_token)
        if ok:
            return redirect(f"/?google_connected=1&email={urllib.parse.quote(google_email)}")
        else:
            return redirect(f"/?google_error={urllib.parse.quote(str(res))}")

    except Exception as e:
        logger.error(f"Google OAuth callback error: {e}")
        return redirect(f"/?google_error={urllib.parse.quote(str(e))}")

@app.route("/api/google/disconnect", methods=["POST"])
def google_disconnect():
    google_sync.disconnect_google()
    return jsonify({"ok": True, "message": "ตัดการเชื่อมต่อ Google เรียบร้อยแล้ว"})


# ─────────────────────────────────────────────────────────────
# Image Upload & OCR Analysis (Prescription / QR scan)
# ─────────────────────────────────────────────────────────────

@app.route("/api/scan-image", methods=["POST"])
def scan_image():
    """
    Accepts uploaded photo of prescription, label, or QR code.
    Runs OCR and returns detected drug and quantity.
    """
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "ไม่พบไฟล์ภาพที่อัปโหลด"}), 400

    f = request.files["file"]
    image_bytes = f.read()
    if not image_bytes:
        return jsonify({"ok": False, "error": "ไฟล์ภาพว่างเปล่า"}), 400

    analysis = parse_drug_from_image(image_bytes)
    return jsonify({"ok": True, "analysis": analysis})

UPLOAD_DRUG_FOLDER = os.environ.get(
    "UPLOAD_DRUG_FOLDER",
    "/tmp/uploads/drugs" if os.environ.get("VERCEL") else os.path.join(os.path.dirname(__file__), "static", "uploads", "drugs")
)
try:
    os.makedirs(UPLOAD_DRUG_FOLDER, exist_ok=True)
except Exception:
    pass
ALLOWED_IMAGE_EXTS = {"png", "jpg", "jpeg", "webp", "gif"}

def allowed_image_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTS

@app.route("/api/upload/drug-image", methods=["POST"])
def upload_drug_image():
    """Upload drug image and return accessible static URL."""
    file = request.files.get("image") or request.files.get("file")
    if not file or file.filename == "":
        return jsonify({"ok": False, "error": "ไม่พบไฟล์ภาพที่อัปโหลด"}), 400
    if not allowed_image_file(file.filename):
        return jsonify({"ok": False, "error": "รองรับเฉพาะไฟล์รูปภาพ (PNG, JPG, JPEG, WEBP, GIF)"}), 400

    try:
        import uuid
        ext = file.filename.rsplit(".", 1)[1].lower()
        unique_name = f"drug_{uuid.uuid4().hex[:12]}.{ext}"
        filepath = os.path.join(UPLOAD_DRUG_FOLDER, unique_name)
        file.save(filepath)
        image_url = f"/static/uploads/drugs/{unique_name}"
        return jsonify({"ok": True, "image_url": image_url})
    except Exception as e:
        logger.error(f"Error saving uploaded drug image: {e}")
        return jsonify({"ok": False, "error": f"เกิดข้อผิดพลาดในการบันทึกรูปภาพ: {str(e)}"}), 500

@app.route("/api/sync-sheet", methods=["POST"])
def trigger_sheet_sync():
    """Manually force re-sync with Google Sheets (both inventory and dispensing logs)."""
    drugs = database.get_all_drugs()
    success1, msg1 = google_sync.sync_all_drugs_to_sheet(drugs)
    success2, msg2 = google_sync.sync_all_dispensing_logs()
    return jsonify({
        "ok": success1 and success2,
        "message": "ซิงค์ข้อมูลทั้งคลังยาและประวัติการตัดสต็อกขึ้น Google Sheets เรียบร้อยแล้ว"
    })

# ─────────────────────────────────────────────────────────────
# Excel Export Routes
# ─────────────────────────────────────────────────────────────

@app.route("/api/export/inventory", methods=["GET"])
def export_inventory_excel():
    """Export all drug inventory to a styled Excel (.xlsx) file."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        return jsonify({"ok": False, "error": "openpyxl is not installed"}), 500

    drugs = database.get_all_drugs()
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "รายการยาในคลัง"

    # ── Style helpers ──
    header_fill   = PatternFill("solid", fgColor="1E3A5F")
    low_fill      = PatternFill("solid", fgColor="FFF1F2")
    alt_fill      = PatternFill("solid", fgColor="F8FAFC")
    header_font   = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    body_font     = Font(name="Calibri", size=10)
    bold_font     = Font(name="Calibri", bold=True, size=10)
    danger_font   = Font(name="Calibri", bold=True, color="E11D48", size=10)
    center        = Alignment(horizontal="center", vertical="center", wrap_text=False)
    left          = Alignment(horizontal="left",   vertical="center", wrap_text=False)
    thin_side     = Side(style="thin", color="CBD5E1")
    thin_border   = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    # ── Title row ──
    ws.merge_cells("A1:K1")
    title_cell = ws["A1"]
    title_cell.value = f"รายงานคลังยา — PharmaCore  (ส่งออก {datetime.now().strftime('%d/%m/%Y %H:%M')})"
    title_cell.font  = Font(name="Calibri", bold=True, color="1E3A5F", size=14)
    title_cell.alignment = left
    ws.row_dimensions[1].height = 26

    # ── Header row ──
    headers = ["ลำดับ", "รหัสยา", "ชื่อยา", "ชื่อสามัญ", "หมวดหมู่",
               "รูปแบบยา", "สต็อกคงเหลือ", "หน่วย", "จุดเตือนขั้นต่ำ",
               "ราคา (บาท)", "ตำแหน่งจัดเก็บ"]
    col_widths = [6, 13, 30, 25, 22, 20, 15, 10, 17, 13, 20]

    ws.append(headers)
    for c_idx, (header, width) in enumerate(zip(headers, col_widths), start=1):
        cell = ws.cell(row=2, column=c_idx)
        cell.font      = header_font
        cell.fill      = header_fill
        cell.alignment = center
        cell.border    = thin_border
        ws.column_dimensions[get_column_letter(c_idx)].width = width
    ws.row_dimensions[2].height = 22

    # ── Data rows ──
    for row_num, d in enumerate(drugs, start=1):
        is_low = (d.get("stock_qty", 0) or 0) <= (d.get("min_threshold", 10) or 10)
        row_data = [
            row_num,
            d.get("code", ""),
            d.get("name", ""),
            d.get("generic_name") or "",
            d.get("category", ""),
            d.get("dosage_form") or "",
            d.get("stock_qty", 0),
            d.get("unit", ""),
            d.get("min_threshold", 10),
            d.get("price") or 0,
            d.get("location") or "",
        ]
        ws.append(row_data)
        xlsx_row = row_num + 2
        row_fill = low_fill if is_low else (alt_fill if row_num % 2 == 0 else None)
        for c_idx in range(1, 12):
            cell = ws.cell(row=xlsx_row, column=c_idx)
            cell.border    = thin_border
            cell.alignment = center if c_idx in (1, 7, 8, 9, 10) else left
            cell.font      = (danger_font if c_idx == 7 and is_low else body_font)
            if c_idx == 7 and is_low:
                cell.font = danger_font
            elif c_idx in (1, 2):
                cell.font = bold_font
            if row_fill:
                cell.fill = row_fill
        ws.row_dimensions[xlsx_row].height = 18

    # ── Freeze panes (keep header visible) ──
    ws.freeze_panes = "A3"
    ws.auto_filter.ref = f"A2:K{len(drugs) + 2}"

    buf = BytesIO()
    wb.save(buf)
    xlsx_bytes = buf.getvalue()
    filename = f"pharmacore_inventory_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    resp = make_response(xlsx_bytes)
    resp.headers["Content-Type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp.headers["Content-Length"] = len(xlsx_bytes)
    return resp


@app.route("/api/export/logs", methods=["GET"])
def export_logs_excel():
    """Export dispensing logs to a styled Excel (.xlsx) file."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        return jsonify({"ok": False, "error": "openpyxl is not installed"}), 500

    date_filter    = request.args.get("date")
    start_date     = request.args.get("start_date")
    end_date       = request.args.get("end_date")
    channel_filter = request.args.get("channel")
    logs = database.get_dispensing_logs(
        limit=10000,
        date_filter=date_filter,
        channel_filter=channel_filter,
        start_date=start_date,
        end_date=end_date
    )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "ประวัติการตัดสต็อก"

    header_fill = PatternFill("solid", fgColor="0D3B66")
    alt_fill    = PatternFill("solid", fgColor="F1F5F9")
    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    body_font   = Font(name="Calibri", size=10)
    bold_font   = Font(name="Calibri", bold=True, size=10)
    red_font    = Font(name="Calibri", bold=True, color="E11D48", size=10)
    green_font  = Font(name="Calibri", bold=True, color="059669", size=10)
    center      = Alignment(horizontal="center", vertical="center")
    left        = Alignment(horizontal="left",   vertical="center")
    thin_side   = Side(style="thin", color="CBD5E1")
    thin_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    # ── Title ──
    ws.merge_cells("A1:I1")
    title_cell = ws["A1"]
    if start_date and end_date:
        date_label = f" ({start_date} ถึง {end_date})"
        file_suffix = f"{start_date.replace('-', '')}_{end_date.replace('-', '')}"
    elif start_date:
        date_label = f" (ตั้งแต่ {start_date})"
        file_suffix = f"from_{start_date.replace('-', '')}"
    elif end_date:
        date_label = f" (ถึง {end_date})"
        file_suffix = f"until_{end_date.replace('-', '')}"
    elif date_filter:
        date_label = f" ({date_filter})"
        file_suffix = f"{date_filter.replace('-', '')}"
    else:
        date_label = ""
        file_suffix = datetime.now().strftime('%Y%m%d_%H%M')

    title_cell.value = f"ประวัติการตัดสต็อก — PharmaCore{date_label}  (ส่งออก {datetime.now().strftime('%d/%m/%Y %H:%M')})"
    title_cell.font  = Font(name="Calibri", bold=True, color="0D3B66", size=14)
    title_cell.alignment = left
    ws.row_dimensions[1].height = 26

    # ── Header ──
    headers    = ["ลำดับ", "วัน-เวลา", "รหัสยา", "ชื่อยา", "จำนวนจ่าย",
                  "คงก่อน", "คงหลัง", "ช่องทาง", "ผู้จ่ายยา"]
    col_widths = [6, 20, 13, 30, 13, 10, 10, 16, 22]

    ws.append(headers)
    for c_idx, (header, width) in enumerate(zip(headers, col_widths), start=1):
        cell = ws.cell(row=2, column=c_idx)
        cell.font      = header_font
        cell.fill      = header_fill
        cell.alignment = center
        cell.border    = thin_border
        ws.column_dimensions[get_column_letter(c_idx)].width = width
    ws.row_dimensions[2].height = 22

    # ── Data ──
    for row_num, l in enumerate(logs, start=1):
        row_data = [
            row_num,
            l.get("created_at", ""),
            l.get("drug_code", ""),
            l.get("drug_name", ""),
            -abs(l.get("quantity", 0)),
            l.get("balance_before", 0),
            l.get("balance_after", 0),
            l.get("channel", ""),
            l.get("dispensed_by", ""),
        ]
        ws.append(row_data)
        xlsx_row = row_num + 2
        row_fill = alt_fill if row_num % 2 == 0 else None
        for c_idx in range(1, 10):
            cell = ws.cell(row=xlsx_row, column=c_idx)
            cell.border    = thin_border
            cell.alignment = center if c_idx in (1, 5, 6, 7) else left
            if c_idx == 5:
                cell.font = red_font
            elif c_idx == 7:
                cell.font = green_font
            elif c_idx in (1, 3):
                cell.font = bold_font
            else:
                cell.font = body_font
            if row_fill:
                cell.fill = row_fill
        ws.row_dimensions[xlsx_row].height = 18

    ws.freeze_panes = "A3"
    ws.auto_filter.ref = f"A2:I{len(logs) + 2}"

    buf = BytesIO()
    wb.save(buf)
    xlsx_bytes = buf.getvalue()
    filename = f"pharmacore_logs_{file_suffix}.xlsx"
    resp = make_response(xlsx_bytes)
    resp.headers["Content-Type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp.headers["Content-Length"] = len(xlsx_bytes)
    return resp


@app.route("/api/export/stock-in", methods=["GET"])
def export_stock_in_excel():
    """Export stock-in receiving logs to a styled Excel (.xlsx) file."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        return jsonify({"ok": False, "error": "openpyxl is not installed"}), 500

    date_filter = request.args.get("date")
    start_date  = request.args.get("start_date")
    end_date    = request.args.get("end_date")
    drug_id     = request.args.get("drug_id")
    logs = database.get_stock_in_logs(
        limit=10000,
        drug_id=drug_id,
        date_filter=date_filter,
        start_date=start_date,
        end_date=end_date
    )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "ประวัติการรับยาเข้า"

    header_fill = PatternFill("solid", fgColor="059669")
    alt_fill    = PatternFill("solid", fgColor="F0FDF4")
    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    body_font   = Font(name="Calibri", size=10)
    bold_font   = Font(name="Calibri", bold=True, size=10)
    green_font  = Font(name="Calibri", bold=True, color="059669", size=10)
    center      = Alignment(horizontal="center", vertical="center")
    left        = Alignment(horizontal="left",   vertical="center")
    right       = Alignment(horizontal="right",  vertical="center")
    thin_side   = Side(style="thin", color="CBD5E1")
    thin_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    # ── Title ──
    ws.merge_cells("A1:N1")
    title_cell = ws["A1"]
    if start_date and end_date:
        date_label = f" ({start_date} ถึง {end_date})"
        file_suffix = f"{start_date.replace('-', '')}_{end_date.replace('-', '')}"
    elif start_date:
        date_label = f" (ตั้งแต่ {start_date})"
        file_suffix = f"from_{start_date.replace('-', '')}"
    elif end_date:
        date_label = f" (ถึง {end_date})"
        file_suffix = f"until_{end_date.replace('-', '')}"
    elif date_filter:
        date_label = f" ({date_filter})"
        file_suffix = f"{date_filter.replace('-', '')}"
    else:
        date_label = ""
        file_suffix = datetime.now().strftime('%Y%m%d_%H%M')

    title_cell.value = f"ประวัติการรับยาเข้าคลัง — PharmaCore{date_label}  (ส่งออก {datetime.now().strftime('%d/%m/%Y %H:%M')})"
    title_cell.font  = Font(name="Calibri", bold=True, color="059669", size=14)
    title_cell.alignment = left
    ws.row_dimensions[1].height = 26

    # ── Header ──
    headers = [
        "ลำดับ", "วัน-เวลาที่รับ", "รหัสยา", "ชื่อยา", "เลขล็อต (Lot)",
        "จำนวนรับเข้า", "คงเหลือก่อน", "คงเหลือหลัง", "ทุน/หน่วย (฿)", "รวมมูลค่าทุน (฿)",
        "ผู้จัดจำหน่าย (Supplier)", "วันหมดอายุ", "ผู้ตรวจรับ", "หมายเหตุ"
    ]
    col_widths = [6, 20, 13, 30, 16, 14, 12, 12, 14, 16, 24, 14, 18, 22]

    ws.append(headers)
    for c_idx, (header, width) in enumerate(zip(headers, col_widths), start=1):
        cell = ws.cell(row=2, column=c_idx)
        cell.font      = header_font
        cell.fill      = header_fill
        cell.alignment = center
        cell.border    = thin_border
        ws.column_dimensions[get_column_letter(c_idx)].width = width
    ws.row_dimensions[2].height = 22

    # ── Data ──
    for row_num, l in enumerate(logs, start=1):
        row_data = [
            row_num,
            l.get("created_at", ""),
            l.get("drug_code", ""),
            l.get("drug_name", ""),
            l.get("lot_number", "-") or "-",
            l.get("quantity", 0),
            l.get("balance_before", 0),
            l.get("balance_after", 0),
            float(l.get("cost_per_unit", 0) or 0),
            float(l.get("total_cost", 0) or 0),
            l.get("supplier", "-") or "-",
            l.get("expiry_date", "-") or "-",
            l.get("received_by", "-") or "-",
            l.get("notes", "") or "",
        ]
        ws.append(row_data)
        xlsx_row = row_num + 2
        row_fill = alt_fill if row_num % 2 == 0 else None
        for c_idx in range(1, 15):
            cell = ws.cell(row=xlsx_row, column=c_idx)
            cell.border    = thin_border
            cell.alignment = center if c_idx in (1, 5, 6, 7, 8, 12) else (right if c_idx in (9, 10) else left)
            if c_idx in (6, 8, 10):
                cell.font = green_font
            elif c_idx in (1, 3):
                cell.font = bold_font
            else:
                cell.font = body_font
            if row_fill:
                cell.fill = row_fill
            if c_idx in (9, 10):
                cell.number_format = "#,##0.00"
        ws.row_dimensions[xlsx_row].height = 18

    ws.freeze_panes = "A3"
    ws.auto_filter.ref = f"A2:N{len(logs) + 2}"

    buf = BytesIO()
    wb.save(buf)
    xlsx_bytes = buf.getvalue()
    filename = f"pharmacore_stockin_{file_suffix}.xlsx"
    resp = make_response(xlsx_bytes)
    resp.headers["Content-Type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    resp.headers["Content-Length"] = len(xlsx_bytes)
    return resp

# ─────────────────────────────────────────────────────────────
# LINE Webhook Endpoint
# ─────────────────────────────────────────────────────────────

@app.route("/webhook", methods=["POST", "GET"])
@app.route("/line/webhook", methods=["POST", "GET"])
@app.route("/api/line/webhook", methods=["POST", "GET"])
@app.route("/api/line-webhook", methods=["POST", "GET"])
@app.route("/api/webhook", methods=["POST", "GET"])
def line_webhook():
    if request.method == "GET":
        return "Pharmacy LINE Bot Webhook Active", 200

    body = request.get_data(as_text=True)
    try:
        events = json.loads(body).get("events", [])
        for ev in events:
            line_bot.handle_webhook_event(ev)
        return "OK", 200
    except Exception as e:
        logger.error(f"Error handling LINE webhook: {e}")
        return "Internal Error", 500

# ─────────────────────────────────────────────────────────────
# LINE Notification & Expiry Alert API
# ─────────────────────────────────────────────────────────────

@app.route("/api/line/config", methods=["GET"])
def get_line_config():
    subscribers = database.get_line_subscribers()
    target_id = Config.PHARMACY_LINE_TARGET_ID or database.get_app_setting("line_notify_target") or ""
    days = int(database.get_app_setting("expiry_alert_days") or Config.EXPIRY_ALERT_DAYS or 60)
    last_sent = database.get_app_setting("last_expiry_alert_sent") or "ยังไม่เคยส่ง"
    expiring = database.get_expiring_drugs(days=days)

    return jsonify({
        "ok": True,
        "is_configured": bool(Config.LINE_CHANNEL_ACCESS_TOKEN),
        "bot_basic_id": Config.LINE_BOT_BASIC_ID,
        "target_id": target_id,
        "expiry_alert_days": days,
        "expiring_count": len(expiring),
        "subscribers_count": len(subscribers),
        "subscribers": subscribers[:10],
        "last_alert_sent": last_sent,
        "webhook_url": f"{Config.BASE_URL}/webhook"
    })

@app.route("/api/line/config", methods=["POST"])
def update_line_config():
    data = request.json or {}
    target_id = data.get("target_id")
    days = data.get("expiry_alert_days")

    if target_id is not None:
        database.set_app_setting("line_notify_target", str(target_id).strip())
    if days is not None:
        try:
            database.set_app_setting("expiry_alert_days", int(days))
        except ValueError:
            pass

    return jsonify({"ok": True, "message": "อัปเดตการตั้งค่า LINE เรียบร้อยแล้ว"})

@app.route("/api/line/send-expiry-alert", methods=["POST"])
def trigger_line_expiry_alert():
    """Manual or API trigger to send expiration alert to LINE."""
    data = request.json or {}
    days_input = data.get("days")
    days = int(days_input) if days_input else int(database.get_app_setting("expiry_alert_days") or Config.EXPIRY_ALERT_DAYS or 60)
    target_id = data.get("target_id")
    force = data.get("force", True)

    result = line_bot.send_expiring_drugs_alert(days=days, target_id=target_id, force=force)
    return jsonify(result)

# ─────────────────────────────────────────────────────────────
# Automatic Scheduled Expiry Alert Daemon
# ─────────────────────────────────────────────────────────────

def start_expiry_alert_scheduler():
    """
    Background daemon thread that checks expiring drugs once per day and alerts LINE.
    Runs silently in background.
    """
    import threading
    import time

    def _loop():
        time.sleep(10) # Initial grace period
        while True:
            try:
                days = int(database.get_app_setting("expiry_alert_days") or Config.EXPIRY_ALERT_DAYS or 60)
                # Calls send_expiring_drugs_alert with force=False so it only triggers once per day
                line_bot.send_expiring_drugs_alert(days=days, force=False)
            except Exception as e:
                logger.warning(f"Expiry alert background loop error: {e}")
            time.sleep(3600 * 2) # Check every 2 hours

    scheduler_thread = threading.Thread(target=_loop, daemon=True, name="PharmacyExpiryScheduler")
    scheduler_thread.start()
    logger.info("⏰ Pharmacy Expiry Alert background scheduler started.")

# ─────────────────────────────────────────────────────────────
# System Status & Health
# ─────────────────────────────────────────────────────────────

@app.route("/api/status", methods=["GET"])
def system_status():
    return jsonify({
        "status": "healthy",
        "app": "Pharmacy Stock Management System",
        "version": "1.1.0",
        "port": Config.PORT,
        "database": Config.DB_PATH,
        "google_sheets_connected": google_sync.is_connected,
        "google_spreadsheet_id": google_sync.spreadsheet_id,
        "line_bot_configured": bool(Config.LINE_CHANNEL_ACCESS_TOKEN),
        "expiry_alert_configured": True
    })

if __name__ == "__main__":
    port = Config.PORT
    print(f"\n=======================================================")
    print(f"🏥 PHARMACY STOCK MANAGEMENT SYSTEM RUNNING ON PORT {port}")
    print(f"👉 Local Access:   http://localhost:{port}")
    print(f"👉 Public Domain:  {Config.BASE_URL}")
    print(f"👉 LINE Webhook:   {Config.BASE_URL}/webhook")
    print(f"=======================================================\n")
    app.run(host="0.0.0.0", port=port, debug=False)
