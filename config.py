import os
from pathlib import Path
from dotenv import load_dotenv

# Base directory for pharmacy system
BASE_DIR = Path(__file__).parent.absolute()
ROOT_DIR = BASE_DIR.parent

# Dedicated subproject .env and parent fallback paths
pharmacy_env = BASE_DIR / ".env"
webai_env = ROOT_DIR / "webai" / ".env"
root_env = ROOT_DIR / ".env"

if root_env.exists():
    load_dotenv(root_env, override=False)
if webai_env.exists():
    load_dotenv(webai_env, override=False)
if pharmacy_env.exists():
    load_dotenv(pharmacy_env, override=True)

class Config:
    SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", "pharmacy_medical_secret_key_2026_xyz")
    PORT = int(os.environ.get("PHARMACY_PORT", os.environ.get("PORT", 5005)))
    BASE_URL = os.environ.get("BASE_URL", "https://pharmacy.openchat.sbs").rstrip("/")
    
    # SQLite Database
    DB_PATH = str(BASE_DIR / "pharmacy.db")
    
    # Uploads folder for receipts/prescriptions
    UPLOAD_FOLDER = str(BASE_DIR / "uploads")
    
    # LINE Bot credentials (shared from existing setup)
    LINE_CHANNEL_ACCESS_TOKEN = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    LINE_CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "").strip()
    LINE_BOT_BASIC_ID = os.environ.get("LINE_BOT_BASIC_ID", "@905gsngi").strip()
    PHARMACY_LINE_TARGET_ID = os.environ.get("PHARMACY_LINE_TARGET_ID", os.environ.get("LINE_NOTIFY_TARGET_ID", "")).strip()
    EXPIRY_ALERT_DAYS = int(os.environ.get("EXPIRY_ALERT_DAYS", 60))
    
    # Google Workspace credentials
    GOOGLE_SERVICE_ACCOUNT_JSON = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    
    # Google OAuth2 (Sign in with Google - Automatic Sheet/Drive Creation)
    GOOGLE_OAUTH2_CLIENT_ID = os.environ.get("GOOGLE_OAUTH2_CLIENT_ID", os.environ.get("GOOGLE_CLIENT_ID", "")).strip()
    GOOGLE_OAUTH2_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH2_CLIENT_SECRET", "").strip()
    OAUTH2_REDIRECT_URI = os.environ.get("OAUTH2_REDIRECT_URI", f"{BASE_URL}/api/auth/google/callback").strip()
    
    # Dedicated Pharmacy Google Sheet & Drive (Separate from OrgChat to prevent collision!)
    PHARMACY_SPREADSHEET_ID = os.environ.get("PHARMACY_SPREADSHEET_ID", "").strip()
    PHARMACY_DRIVE_FOLDER_ID = os.environ.get("PHARMACY_DRIVE_FOLDER_ID", "").strip()
    
    # AI / OCR Provider
    GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
    
    # Timezone
    TIMEZONE = "Asia/Bangkok"

# Ensure upload directory exists safely
try:
    os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
except Exception:
    pass
