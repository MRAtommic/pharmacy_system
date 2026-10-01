"""
Runner script for Pharmacy Management System
"""
import sys
from app import app
from config import Config

if __name__ == "__main__":
    print(f"🏥 Starting Pharmacy Management System on http://0.0.0.0:{Config.PORT}...")
    app.run(host="0.0.0.0", port=Config.PORT, debug=True)
