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

# Parent-folder .env files belong to OTHER projects (e.g. OrgChat/webai). They are no longer loaded
# automatically, so their secrets and LINE/Google credentials can't leak into this app.
# Set PHARMACY_USE_PARENT_ENV=1 in the real environment to opt back in.
if os.environ.get("PHARMACY_USE_PARENT_ENV", "").strip().lower() in ("1", "true", "yes"):
    if root_env.exists():
        load_dotenv(root_env, override=False)
    if webai_env.exists():
        load_dotenv(webai_env, override=False)
if pharmacy_env.exists():
    load_dotenv(pharmacy_env, override=True)

def _env(name: str, default: str = "") -> str:
    """Environment variable, treating a blank value (e.g. copied from .env.example) as 'not set'."""
    value = os.environ.get(name, "").strip()
    return value if value else default


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


def _load_secret_key() -> str:
    """Session-signing key: FLASK_SECRET_KEY env var, else a random key generated once and kept in .secret_key.

    (The old hard-coded default key was public in the source code, which would let anyone forge a login session.)
    """
    env_key = os.environ.get("FLASK_SECRET_KEY", "").strip()
    if env_key:
        return env_key
    key_file = BASE_DIR / ".secret_key"
    try:
        if key_file.exists():
            saved = key_file.read_text(encoding="utf-8").strip()
            if saved:
                return saved
        import secrets
        new_key = secrets.token_hex(32)
        key_file.write_text(new_key, encoding="utf-8")
        return new_key
    except OSError:
        # Read-only filesystem (e.g. serverless): sessions simply reset on restart
        import secrets
        return secrets.token_hex(32)


class Config:
    SECRET_KEY = _load_secret_key()
    # Comma-separated allow-lists for Google sign-in, e.g. ALLOWED_LOGIN_EMAILS=a@x.com,b@y.com
    ALLOWED_LOGIN_EMAILS = {e.strip().lower() for e in os.environ.get("ALLOWED_LOGIN_EMAILS", "").split(",") if e.strip()}
    ALLOWED_LOGIN_DOMAINS = {d.strip().lower().lstrip("@") for d in os.environ.get("ALLOWED_LOGIN_DOMAINS", "").split(",") if d.strip()}
    COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "").strip().lower() in ("1", "true", "yes")
    PORT = _env_int("PHARMACY_PORT", _env_int("PORT", 5005))
    # Public URL of this app (used in LINE links, OAuth redirects, QR codes). Set BASE_URL in .env for production.
    BASE_URL = _env("BASE_URL").rstrip("/") or f"http://localhost:{PORT}"
    # Extra hostnames (comma-separated) that may be used to build the Google OAuth redirect URI, e.g. an ngrok domain
    OAUTH_TRUSTED_HOSTS = {h.strip().lower() for h in os.environ.get("OAUTH_TRUSTED_HOSTS", "").split(",") if h.strip()}
    
    # SQLite Database
    DB_PATH = _env("DB_PATH", str(Path("/tmp/pharmacy.db") if os.environ.get("VERCEL") else BASE_DIR / "pharmacy.db"))

    # Uploads folder for receipts/prescriptions
    UPLOAD_FOLDER = _env("UPLOAD_FOLDER", str(Path("/tmp/uploads") if os.environ.get("VERCEL") else BASE_DIR / "uploads"))
    
    # LINE Bot credentials (shared from existing setup)
    LINE_CHANNEL_ACCESS_TOKEN = os.environ.get("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
    LINE_CHANNEL_SECRET = os.environ.get("LINE_CHANNEL_SECRET", "").strip()
    LINE_BOT_BASIC_ID = os.environ.get("LINE_BOT_BASIC_ID", "@905gsngi").strip()
    PHARMACY_LINE_TARGET_ID = os.environ.get("PHARMACY_LINE_TARGET_ID", os.environ.get("LINE_NOTIFY_TARGET_ID", "")).strip()
    EXPIRY_ALERT_DAYS = _env_int("EXPIRY_ALERT_DAYS", 60)
    
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

    # Organisation profile printed on stock cards / requisition forms.
    # Defaults keep the current deployment's values; override any of them in .env (ORG_NAME=..., ORG_REQUESTER_NAME=...).
    ORG_NAME = _env("ORG_NAME", "โรงพยาบาลส่งเสริมสุขภาพตำบลดอนนาลับ อำเภอบ้านดุง จังหวัดอุดรธานี")
    ORG_OPENING_SIGN = _env("ORG_OPENING_SIGN", "วราภรณ์")
    ORG_REQUESTER_NAME = _env("ORG_REQUESTER_NAME", "นางสาวกรรณิกา ชัยเลิศ")
    ORG_REQUESTER_TITLE = _env("ORG_REQUESTER_TITLE", "พยาบาลวิชาชีพชำนาญการ")
    ORG_DISPENSER_NAME = _env("ORG_DISPENSER_NAME", "นางสาววราภรณ์ สีหนาจ")
    ORG_DISPENSER_TITLE = _env("ORG_DISPENSER_TITLE", "พยาบาลวิชาชีพชำนาญการ")
    ORG_AUTHORIZER_NAME = _env("ORG_AUTHORIZER_NAME", "นายชุมสาย วิชาชัย")
    ORG_AUTHORIZER_TITLE = _env("ORG_AUTHORIZER_TITLE", "ผอ.รพ.สต.ดอนนาลับ")
    ORG_RECEIVER_NAME = _env("ORG_RECEIVER_NAME", "นางกัลตะนา เมืองจันทร์")
    ORG_RECEIVER_TITLE = _env("ORG_RECEIVER_TITLE", "พสอ.")


def fiscal_year_be(on_date=None) -> int:
    """Thai government fiscal year (Buddhist Era) that contains `on_date`: it starts on 1 October."""
    from datetime import date, datetime
    if on_date is None:
        on_date = date.today()
    elif isinstance(on_date, str):
        try:
            on_date = datetime.strptime(on_date[:10], "%Y-%m-%d").date()
        except ValueError:
            on_date = date.today()
    elif isinstance(on_date, datetime):
        on_date = on_date.date()
    return on_date.year + 543 + (1 if on_date.month >= 10 else 0)

# Ensure upload directory exists safely
try:
    os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
except Exception:
    pass
