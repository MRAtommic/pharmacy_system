"""
Google Sheets & Google Drive Sync Service for Pharmacy System
Completely isolated from the existing OrgChat sheets and folders to prevent data collision!
"""

import os
import io
import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
import re
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError
from config import Config
import database

logger = logging.getLogger("pharmacy_google_sync")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

BANGKOK_TZ = ZoneInfo("Asia/Bangkok")

OAUTH2_SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets'
]

def extract_google_id(url_or_id, kind="sheet"):
    """Extract ID from Google Sheet or Google Drive URL, or return stripped raw ID."""
    if not url_or_id:
        return ""
    s = str(url_or_id).strip()
    # Match Google Spreadsheet URL: /spreadsheets/d/([a-zA-Z0-9-_]+)
    m_sheet = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", s)
    if m_sheet:
        return m_sheet.group(1)
    # Match Google Drive folder URL: /folders/([a-zA-Z0-9-_]+)
    m_drive = re.search(r"/folders/([a-zA-Z0-9-_]+)", s)
    if m_drive:
        return m_drive.group(1)
    # Return as raw ID if it looks like an alphanumeric ID without slashes
    if "/" not in s and "?" not in s and len(s) > 15:
        return s
    return s

class PharmacyGoogleService:
    def __init__(self):
        self.creds = None
        self.sheets_service = None
        self.drive_service = None
        self.is_connected = False
        self.connection_error = None
        self.service_account_email = None
        self.auth_type = "none"  # "oauth" | "service_account" | "none"
        self.connected_email = None
        
        # Load from database settings first, then config/env
        self.spreadsheet_id = database.get_app_setting("pharmacy_spreadsheet_id") or Config.PHARMACY_SPREADSHEET_ID
        self.drive_folder_id = database.get_app_setting("pharmacy_drive_folder_id") or Config.PHARMACY_DRIVE_FOLDER_ID
        
        self._init_client()

    def _init_client(self):
        """Initialize Google API client using OAuth2 user tokens first, then service account."""
        self.is_connected = False
        self.connection_error = None

        # 1. Try OAuth2 User Tokens first (Automatic Connection)
        oauth_refresh = database.get_app_setting("google_oauth_refresh_token")
        oauth_access = database.get_app_setting("google_oauth_access_token")
        oauth_email = database.get_app_setting("google_oauth_email")

        if oauth_refresh or oauth_access:
            try:
                creds = Credentials(
                    token=oauth_access,
                    refresh_token=oauth_refresh,
                    token_uri='https://oauth2.googleapis.com/token',
                    client_id=Config.GOOGLE_OAUTH2_CLIENT_ID,
                    client_secret=Config.GOOGLE_OAUTH2_CLIENT_SECRET,
                    scopes=OAUTH2_SCOPES
                )

                if (not creds.valid or creds.expired) and creds.refresh_token:
                    try:
                        creds.refresh(Request())
                        database.set_app_setting("google_oauth_access_token", creds.token)
                        logger.info("🔄 Refreshed Google OAuth token successfully")
                    except Exception as e:
                        logger.warning(f"OAuth refresh failed: {e}")

                if creds.valid:
                    self.creds = creds
                    self.sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)
                    self.drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
                    self.is_connected = True
                    self.auth_type = "oauth"
                    self.connected_email = oauth_email or "Google User"
                    self.service_account_email = None
                    logger.info(f"✅ Google API connected via User OAuth2: {self.connected_email}")
                    return
            except Exception as e:
                logger.warning(f"OAuth initialization error: {e}")

        # 2. Fallback to Service Account JSON
        sa_raw = database.get_app_setting("google_service_account_json") or Config.GOOGLE_SERVICE_ACCOUNT_JSON
        if not sa_raw:
            self.connection_error = "ยังไม่ได้เชื่อมต่อ Google Account (คลิกปุ่มเชื่อมต่อ Google ด้านบนได้เลยค่ะ)"
            return

        try:
            info = json.loads(sa_raw)
            self.service_account_email = info.get("client_email", "unknown@serviceaccount.com")
            scopes = [
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive"
            ]
            self.creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
            self.sheets_service = build("sheets", "v4", credentials=self.creds, cache_discovery=False)
            self.drive_service = build("drive", "v3", credentials=self.creds, cache_discovery=False)
            self.is_connected = True
            self.auth_type = "service_account"
            self.connected_email = self.service_account_email
            logger.info(f"✅ Google API connected via Service Account: {self.service_account_email}")
        except Exception as e:
            self.is_connected = False
            self.connection_error = str(e)
            logger.error(f"❌ Failed to connect to Google API: {e}")

    def setup_oauth_workspace(self, google_email, access_token, refresh_token):
        """
        Automatically sets up a dedicated Drive folder and Spreadsheet under the user's Google Account.
        Called immediately after user approves Google OAuth permission.
        """
        try:
            database.set_app_setting("google_oauth_access_token", access_token)
            if refresh_token:
                database.set_app_setting("google_oauth_refresh_token", refresh_token)
            database.set_app_setting("google_oauth_email", google_email)

            creds = Credentials(
                token=access_token,
                refresh_token=refresh_token,
                token_uri='https://oauth2.googleapis.com/token',
                client_id=Config.GOOGLE_OAUTH2_CLIENT_ID,
                client_secret=Config.GOOGLE_OAUTH2_CLIENT_SECRET,
                scopes=OAUTH2_SCOPES
            )

            drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
            sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)

            # 1. Search or create dedicated Drive Folder
            folder_name = "🏥 Pharmacy System — คลังยาและใบสั่งยา"
            q_folder = f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
            res_folder = drive_service.files().list(q=q_folder, fields="files(id)", pageSize=1).execute()
            files = res_folder.get("files", [])
            if files:
                folder_id = files[0]["id"]
            else:
                f_meta = {"name": folder_name, "mimeType": "application/vnd.google-apps.folder"}
                f_created = drive_service.files().create(body=f_meta, fields="id").execute()
                folder_id = f_created.get("id")

            self.drive_folder_id = folder_id
            database.set_app_setting("pharmacy_drive_folder_id", folder_id)

            # 2. Search or create dedicated Spreadsheet inside folder
            sheet_title = "🏥 ระบบคลังยาและประวัติการตัดสต็อก (Pharmacy Stock)"
            q_sheet = f"name = '{sheet_title}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false"
            res_sheet = drive_service.files().list(q=q_sheet, fields="files(id)", pageSize=1).execute()
            sheets = res_sheet.get("files", [])

            if sheets:
                spreadsheet_id = sheets[0]["id"]
            else:
                sheet_body = {
                    "properties": {"title": sheet_title},
                    "sheets": [
                        {"properties": {"title": "Drug_Inventory"}},
                        {"properties": {"title": "Dispensing_Logs"}}
                    ]
                }
                new_sheet = sheets_service.spreadsheets().create(body=sheet_body, fields="spreadsheetId").execute()
                spreadsheet_id = new_sheet.get("spreadsheetId")

                # Move spreadsheet into the pharmacy folder
                file_info = drive_service.files().get(fileId=spreadsheet_id, fields="parents").execute()
                prev_parents = ",".join(file_info.get("parents", []))
                drive_service.files().update(
                    fileId=spreadsheet_id,
                    addParents=folder_id,
                    removeParents=prev_parents,
                    fields="id, parents"
                ).execute()

            self.spreadsheet_id = spreadsheet_id
            database.set_app_setting("pharmacy_spreadsheet_id", spreadsheet_id)

            # Re-init client with active credentials
            self.creds = creds
            self.sheets_service = sheets_service
            self.drive_service = drive_service
            self.is_connected = True
            self.auth_type = "oauth"
            self.connected_email = google_email
            self.connection_error = None

            # Setup sheet headers and initial drug sync
            self.ensure_pharmacy_spreadsheet()
            self.sync_all_drugs_to_sheet(database.get_all_drugs())

            logger.info(f"🎉 Fully initialized Google Workspace for {google_email}! Sheet: {spreadsheet_id}, Folder: {folder_id}")
            return True, {
                "spreadsheet_id": spreadsheet_id,
                "drive_folder_id": folder_id,
                "email": google_email
            }
        except Exception as e:
            logger.error(f"Failed to setup OAuth workspace: {e}")
            return False, str(e)

    def disconnect_google(self):
        """Disconnect active Google Account."""
        database.set_app_setting("google_oauth_access_token", "")
        database.set_app_setting("google_oauth_refresh_token", "")
        database.set_app_setting("google_oauth_email", "")
        database.set_app_setting("pharmacy_spreadsheet_id", "")
        database.set_app_setting("pharmacy_drive_folder_id", "")
        self.spreadsheet_id = None
        self.drive_folder_id = None
        self.creds = None
        self.sheets_service = None
        self.drive_service = None
        self.is_connected = False
        self.auth_type = "none"
        self.connected_email = None
        self.connection_error = "ตัดการเชื่อมต่อเรียบร้อยแล้ว"
        return True

    def update_and_reconnect(self, sheet_input=None, drive_input=None, sa_json_input=None):
        """Update Google settings dynamically and verify connection."""
        if sheet_input is not None:
            clean_sheet = extract_google_id(sheet_input, "sheet")
            self.spreadsheet_id = clean_sheet
            database.set_app_setting("pharmacy_spreadsheet_id", clean_sheet)

        if drive_input is not None:
            clean_drive = extract_google_id(drive_input, "drive")
            self.drive_folder_id = clean_drive
            database.set_app_setting("pharmacy_drive_folder_id", clean_drive)

        if sa_json_input:
            database.set_app_setting("google_service_account_json", sa_json_input)

        self._init_client()
        return self.get_connection_info()

    def get_connection_info(self):
        """Detailed status dict for frontend UI."""
        sheet_url = f"https://docs.google.com/spreadsheets/d/{self.spreadsheet_id}/edit" if self.spreadsheet_id else None
        drive_url = f"https://drive.google.com/drive/folders/{self.drive_folder_id}" if self.drive_folder_id else None
        
        sheet_title = None
        if self.is_connected and self.sheets_service and self.spreadsheet_id:
            try:
                meta = self.sheets_service.spreadsheets().get(spreadsheetId=self.spreadsheet_id).execute()
                sheet_title = meta.get("properties", {}).get("title", "Google Sheet")
            except Exception as e:
                sheet_title = f"⚠️ ไม่สามารถเข้าถึง Sheet ได้ ({str(e)[:80]})"

        return {
            "is_connected": self.is_connected,
            "auth_type": self.auth_type,
            "connected_email": self.connected_email or self.service_account_email,
            "service_account_email": self.service_account_email,
            "spreadsheet_id": self.spreadsheet_id,
            "spreadsheet_url": sheet_url,
            "sheet_title": sheet_title,
            "drive_folder_id": self.drive_folder_id,
            "drive_folder_url": drive_url,
            "oauth_available": bool(Config.GOOGLE_OAUTH2_CLIENT_ID and Config.GOOGLE_OAUTH2_CLIENT_SECRET),
            "connection_error": self.connection_error
        }

    def ensure_pharmacy_spreadsheet(self):
        """
        Verify that the pharmacy spreadsheet exists with the 2 required sheets:
        1. Drug_Inventory
        2. Dispensing_Logs
        If not set, attempts to create one or setup headers.
        """
        if not self.is_connected or not self.sheets_service:
            return None, "Google API not connected"

        if not self.spreadsheet_id:
            try:
                # Auto-create dedicated spreadsheet for Pharmacy
                body = {
                    "properties": {"title": "🏥 Pharmacy_Stock_Management_System"},
                    "sheets": [
                        {"properties": {"title": "Drug_Inventory"}},
                        {"properties": {"title": "Dispensing_Logs"}}
                    ]
                }
                res = self.sheets_service.spreadsheets().create(body=body).execute()
                self.spreadsheet_id = res.get("spreadsheetId")
                logger.info(f"🎉 Created brand new Pharmacy Google Spreadsheet: {self.spreadsheet_id}")
                
                # Setup headers
                self._init_sheet_headers()
                return self.spreadsheet_id, None
            except Exception as e:
                logger.error(f"Failed to auto-create spreadsheet: {e}")
                return None, str(e)
        else:
            try:
                # Check existing sheet and create tabs if missing
                meta = self.sheets_service.spreadsheets().get(spreadsheetId=self.spreadsheet_id).execute()
                sheet_titles = [s["properties"]["title"] for s in meta.get("sheets", [])]
                
                requests = []
                if "Drug_Inventory" not in sheet_titles:
                    requests.append({"addSheet": {"properties": {"title": "Drug_Inventory"}}})
                if "Dispensing_Logs" not in sheet_titles:
                    requests.append({"addSheet": {"properties": {"title": "Dispensing_Logs"}}})

                if requests:
                    self.sheets_service.spreadsheets().batchUpdate(
                        spreadsheetId=self.spreadsheet_id,
                        body={"requests": requests}
                    ).execute()
                    self._init_sheet_headers()

                return self.spreadsheet_id, None
            except Exception as e:
                return None, str(e)

    def _format_sheet_tab(self, tab_title, num_cols=10):
        """Format header row (Teal #0F766E, White text, Bold) and freeze row 1."""
        if not self.is_connected or not self.sheets_service or not self.spreadsheet_id:
            return
        try:
            meta = self.sheets_service.spreadsheets().get(spreadsheetId=self.spreadsheet_id).execute()
            sheet_id = None
            for s in meta.get("sheets", []):
                if s["properties"]["title"] == tab_title:
                    sheet_id = s["properties"]["sheetId"]
                    break
            if sheet_id is None:
                return

            reqs = [
                # Freeze row 1
                {
                    "updateSheetProperties": {
                        "properties": {
                            "sheetId": sheet_id,
                            "gridProperties": {"frozenRowCount": 1}
                        },
                        "fields": "gridProperties.frozenRowCount"
                    }
                },
                # Teal header with white bold text
                {
                    "repeatCell": {
                        "range": {
                            "sheetId": sheet_id,
                            "startRowIndex": 0,
                            "endRowIndex": 1,
                            "startColumnIndex": 0,
                            "endColumnIndex": num_cols
                        },
                        "cell": {
                            "userEnteredFormat": {
                                "backgroundColor": {
                                    "red": 15 / 255.0,
                                    "green": 118 / 255.0,
                                    "blue": 110 / 255.0
                                },
                                "horizontalAlignment": "CENTER",
                                "verticalAlignment": "MIDDLE",
                                "textFormat": {
                                    "foregroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0},
                                    "fontSize": 10,
                                    "bold": True
                                }
                            }
                        },
                        "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                    }
                },
                # Auto-resize columns
                {
                    "autoResizeDimensions": {
                        "dimensions": {
                            "sheetId": sheet_id,
                            "dimension": "COLUMNS",
                            "startIndex": 0,
                            "endIndex": num_cols
                        }
                    }
                }
            ]
            self.sheets_service.spreadsheets().batchUpdate(
                spreadsheetId=self.spreadsheet_id,
                body={"requests": reqs}
            ).execute()
        except Exception as e:
            logger.warning(f"Could not format tab {tab_title}: {e}")

    def _init_sheet_headers(self):
        """Setup table headers with clean formatting and colors."""
        if not self.is_connected or not self.spreadsheet_id:
            return

        inventory_headers = [
            ["รหัสยา (Code)", "ชื่อยา (Drug Name)", "ชื่อสามัญ (Generic)", "หมวดหมู่", "รูปแบบยา", 
             "ขนาดยา", "จำนวนคงเหลือ (Stock)", "หน่วยนับ", "จุดเตือนขั้นต่ำ", "ราคา (บาท)", 
             "วันหมดอายุ", "ตำแหน่งจัดเก็บ", "อัปเดตล่าสุด"]
        ]
        logs_headers = [
            ["วัน-เวลาที่ตัดสต็อก", "รหัสยา", "ชื่อยา", "จำนวนที่ตัด", "ยอดก่อนตัด", 
             "ยอดหลังตัด", "ช่องทางการตัด", "ผู้จ่ายยา", "ลิงก์รูปภาพใน Drive", "หมายเหตุ"]
        ]

        try:
            self.sheets_service.spreadsheets().values().update(
                spreadsheetId=self.spreadsheet_id,
                range="Drug_Inventory!A1:M1",
                valueInputOption="USER_ENTERED",
                body={"values": inventory_headers}
            ).execute()

            self.sheets_service.spreadsheets().values().update(
                spreadsheetId=self.spreadsheet_id,
                range="Dispensing_Logs!A1:J1",
                valueInputOption="USER_ENTERED",
                body={"values": logs_headers}
            ).execute()

            self._format_sheet_tab("Drug_Inventory", num_cols=13)
            self._format_sheet_tab("Dispensing_Logs", num_cols=10)
        except Exception as e:
            logger.error(f"Error initializing sheet headers: {e}")

    def sync_all_drugs_to_sheet(self, drugs_list):
        """
        Overwrite the Drug_Inventory tab with the latest drug list.
        Ensures Google Sheet always matches web inventory accurately.
        """
        if not self.is_connected or not self.sheets_service or not self.spreadsheet_id:
            return False, "Google Sheets is not connected"

        rows = [
            ["รหัสยา (Code)", "ชื่อยา (Drug Name)", "ชื่อสามัญ (Generic)", "หมวดหมู่", "รูปแบบยา", 
             "ขนาดยา", "จำนวนคงเหลือ (Stock)", "หน่วยนับ", "จุดเตือนขั้นต่ำ", "ราคา (บาท)", 
             "วันหมดอายุ", "ตำแหน่งจัดเก็บ", "อัปเดตล่าสุด"]
        ]

        for d in drugs_list:
            rows.append([
                d.get("code", ""),
                d.get("name", ""),
                d.get("generic_name", ""),
                d.get("category", ""),
                d.get("dosage_form", ""),
                d.get("strength", ""),
                d.get("stock_qty", 0),
                d.get("unit", ""),
                d.get("min_threshold", 10),
                d.get("price", 0.0),
                d.get("expiry_date", ""),
                d.get("location", ""),
                d.get("updated_at", "")
            ])

        try:
            # Clear old content from A1 downwards
            self.sheets_service.spreadsheets().values().clear(
                spreadsheetId=self.spreadsheet_id,
                range="Drug_Inventory!A1:M2000"
            ).execute()

            # Write updated data
            self.sheets_service.spreadsheets().values().update(
                spreadsheetId=self.spreadsheet_id,
                range="Drug_Inventory!A1",
                valueInputOption="USER_ENTERED",
                body={"values": rows}
            ).execute()

            self._format_sheet_tab("Drug_Inventory", num_cols=13)
            logger.info(f"✅ Synced {len(drugs_list)} drugs to Google Sheet: Drug_Inventory")
            return True, "Synced successfully"
        except Exception as e:
            logger.error(f"Error syncing drugs to Google Sheet: {e}")
            return False, str(e)

    def sync_all_dispensing_logs(self, logs_list=None):
        """
        Full re-sync of all dispensing logs from SQLite into Google Sheet Dispensing_Logs tab.
        Clears any malformed columns and writes neat, formatted records.
        """
        if not self.is_connected or not self.sheets_service or not self.spreadsheet_id:
            return False, "Google Sheets is not connected"

        if logs_list is None:
            try:
                import database
                conn = database.get_db()
                cur = conn.cursor()
                cur.execute("SELECT * FROM dispensing_logs ORDER BY id ASC")
                logs_list = [dict(r) for r in cur.fetchall()]
                conn.close()
            except Exception as e:
                logger.error(f"Failed to fetch logs from DB: {e}")
                logs_list = []

        headers = [
            ["วัน-เวลาที่ตัดสต็อก", "รหัสยา", "ชื่อยา", "จำนวนที่ตัด", "ยอดก่อนตัด", 
             "ยอดหลังตัด", "ช่องทางการตัด", "ผู้จ่ายยา", "ลิงก์รูปภาพใน Drive", "หมายเหตุ"]
        ]
        rows = []
        for l in logs_list:
            rows.append([
                l.get("created_at", ""),
                l.get("drug_code", ""),
                l.get("drug_name", ""),
                l.get("quantity", 0),
                l.get("balance_before", 0),
                l.get("balance_after", 0),
                l.get("channel", "WEB"),
                l.get("dispensed_by", "เจ้าหน้าที่"),
                l.get("drive_file_link", ""),
                l.get("notes", "")
            ])

        all_data = headers + rows
        try:
            # Clear old rows across wide range to prevent ghost columns
            self.sheets_service.spreadsheets().values().clear(
                spreadsheetId=self.spreadsheet_id,
                range="Dispensing_Logs!A1:Z5000"
            ).execute()

            self.sheets_service.spreadsheets().values().update(
                spreadsheetId=self.spreadsheet_id,
                range="Dispensing_Logs!A1",
                valueInputOption="USER_ENTERED",
                body={"values": all_data}
            ).execute()

            # Format header & freeze row 1
            self._format_sheet_tab("Dispensing_Logs", num_cols=10)
            logger.info(f"✅ Synced {len(logs_list)} dispensing logs to Dispensing_Logs tab")
            return True, "Synced successfully"
        except Exception as e:
            logger.error(f"Error syncing dispensing logs to Google Sheet: {e}")
            return False, str(e)

    def append_dispensing_log(self, log_dict):
        """
        Append a single stock deduction record to Dispensing_Logs tab in Google Sheet.
        Uses deterministic row index from column A to guarantee data is never shifted to column J or K.
        """
        if not self.is_connected or not self.sheets_service or not self.spreadsheet_id:
            return False, "Google Sheets is not connected"

        row = [
            log_dict.get("created_at", datetime.now(BANGKOK_TZ).strftime("%Y-%m-%d %H:%M:%S")),
            log_dict.get("drug_code", ""),
            log_dict.get("drug_name", ""),
            log_dict.get("quantity", 0),
            log_dict.get("balance_before", 0),
            log_dict.get("balance_after", 0),
            log_dict.get("channel", "WEB"),
            log_dict.get("dispensed_by", "เจ้าหน้าที่"),
            log_dict.get("drive_file_link", ""),
            log_dict.get("notes", "")
        ]

        try:
            # Determine exact next row from column A
            res = self.sheets_service.spreadsheets().values().get(
                spreadsheetId=self.spreadsheet_id,
                range="Dispensing_Logs!A:A"
            ).execute()
            existing_rows = res.get("values", [])
            next_row = len(existing_rows) + 1
            if next_row <= 1:
                self._init_sheet_headers()
                next_row = 2

            self.sheets_service.spreadsheets().values().update(
                spreadsheetId=self.spreadsheet_id,
                range=f"Dispensing_Logs!A{next_row}:J{next_row}",
                valueInputOption="USER_ENTERED",
                body={"values": [row]}
            ).execute()
            logger.info(f"✅ Appended dispensing log for {log_dict.get('drug_name')} at row {next_row}")
            return True, "Log appended"
        except Exception as e:
            logger.error(f"Error appending log to Google Sheet: {e}")
            return False, str(e)

    def upload_image_to_drive(self, file_bytes, filename, mime_type="image/jpeg"):
        """
        Uploads prescription or slip image to a dedicated Pharmacy Drive folder.
        Returns: (file_id, web_view_link)
        """
        if not self.is_connected or not self.drive_service:
            return None, None

        try:
            # Ensure dedicated folder exists
            folder_id = self.drive_folder_id
            if not folder_id:
                # Search or create folder
                query = "name = '🏥 Pharmacy_Dispensing_Files' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
                res = self.drive_service.files().list(q=query, fields="files(id, name)").execute()
                files = res.get("files", [])
                if files:
                    folder_id = files[0]["id"]
                else:
                    meta = {
                        "name": "🏥 Pharmacy_Dispensing_Files",
                        "mimeType": "application/vnd.google-apps.folder"
                    }
                    folder = self.drive_service.files().create(body=meta, fields="id").execute()
                    folder_id = folder.get("id")
                self.drive_folder_id = folder_id

            media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=mime_type, resumable=True)
            file_metadata = {
                "name": f"RX_{datetime.now(BANGKOK_TZ).strftime('%Y%m%d_%H%M%S')}_{filename}",
                "parents": [folder_id]
            }
            uploaded = self.drive_service.files().create(
                body=file_metadata,
                media_body=media,
                fields="id, webViewLink"
            ).execute()

            # Set public readable link
            try:
                self.drive_service.permissions().create(
                    fileId=uploaded.get("id"),
                    body={"role": "reader", "type": "anyone"}
                ).execute()
            except Exception:
                pass

            return uploaded.get("id"), uploaded.get("webViewLink")
        except Exception as e:
            logger.error(f"Error uploading image to Google Drive: {e}")
            return None, None

# Singleton instance
google_sync = PharmacyGoogleService()
