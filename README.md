<div align="center">

# 🏥 PharmaCore RX-OS
### Intelligent Pharmacy Stock Management & Dispensing System
**ระบบบริหารจัดการคลังยาและการตัดสต็อกอัจฉริยะสำหรับคลินิกและร้านขายยา**

[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Flask 3.0](https://img.shields.io/badge/Flask-3.0.3-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![SQLite](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![LINE Messaging API](https://img.shields.io/badge/LINE-Messaging%20API-00B900?style=for-the-badge&logo=line&logoColor=white)](https://developers.line.biz/)
[![Google Workspace](https://img.shields.io/badge/Google-Drive%20%26%20Sheets-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://workspace.google.com/)

[**ภาษาไทย**](#-ภาษาไทย-thai-version) • [**English**](#-english-version)

---

</div>

## 🇹🇭 ภาษาไทย (Thai Version)

### 📌 เกี่ยวกับโปรเจกต์ (About Project)
**PharmaCore RX-OS** เป็นระบบบริหารจัดการคลังยา จ่ายยา และตัดสต็อกแบบอัตโนมัติ ออกแบบมาเพื่อยกระดับการทำงานของคลินิก สถานพยาบาล และร้านขายยาให้มีความแม่นยำ รวดเร็ว และลดความผิดพลาดในการจ่ายยา (Human Error) ด้วยการผสานเทคโนโลยี **สแกน QR Code/Barcode, ระบบแจ้งเตือนผ่าน LINE อัตโนมัติ, ระบบซิงค์ข้อมูลกับ Google Sheets/Drive และระบบพิมพ์สติ๊กเกอร์ยาแบบปรับแต่งขนาดได้**

---

### ✨ ฟีเจอร์เด่น (Key Features)

1. **📦 การจัดการคลังยาและการควบคุมล็อต (Master Inventory & Lot Management)**
   - บันทึกรายละเอียดตัวยา, ชื่อการค้า, ชื่อสามัญทางยา, รหัสยา, รูปภาพ, ตำแหน่งจัดเก็บ, จุดเตือนสั่งซื้อขั้นต่ำ และล็อตนัมเบอร์
   - ระบบรับยาเข้าคลัง (Stock In) พร้อมบันทึกต้นทุน วันหมดอายุ และซัพพลายเออร์

2. **⚡ การตัดสต็อกและจ่ายยาแบบ Atomic (Atomic Stock Dispensing)**
   - ตัดสต็อกแม่นยำระดับเสี้ยววินาทีด้วย SQLite WAL Transactions
   - รองรับการสแกนจ่ายผ่านกล้องมือถือ/แท็บเล็ต/เครื่องสแกนบาร์โค้ด หรือพิมพ์ค้นหาด้วยระบบ Fuzzy Search ภาษาไทย (เช่น "พารา 2", "อะม็อกซี่ 1")

3. **🖨️ เครื่องพิมพ์สติ๊กเกอร์ QR Code & Barcode หลากขนาด (Custom Sticker Printer Engine)**
   - พิมพ์สติ๊กเกอร์เดี่ยว หรือพิมพ์แบบเป็นชุด (Batch Print) คราวละหลายรายการ
   - มีพรีเซ็ตยอดนิยม: **A4 Micro (20x15mm), Mini (25x20mm), Compact, Thermal Sticker (25x15mm, 30x20mm, 40x30mm, 50x30mm)** และกำหนดขนาดอิสระ (Custom mm)
   - ปรับเลย์เอาต์คอลัมน์ได้สูงสุด 12 คอลัมน์ พร้อมระบบ Dynamic Grid 100% พิมพ์เต็มหน้ากระดาษไม่มีขอบว่าง

4. **⏰ ระบบแจ้งเตือนยาวันหมดอายุอัตโนมัติ (Expiry Alert Daemon)**
   - มอนิเตอร์ยาใกล้หมดอายุแบบเรียลไทม์ (30 วันวิกฤต / 60 วันแจ้งเตือน)
   - แจ้งเตือนเข้ากลุ่มหรือแชท LINE เภสัชกร/เจ้าหน้าที่อัตโนมัติ

5. **☁️ การเชื่อมต่อ Google Workspace & Export Excel**
   - ซิงค์ประวัติการจ่ายยาและข้อมูลคลังยาขึ้น **Google Sheets** อัตโนมัติ
   - แนบหลักฐานรูปภาพใบสั่งยา/ใบเสร็จขึ้น **Google Drive**
   - ส่งออกรายงานสต็อกเป็นไฟล์ Excel (.xlsx) สวยงามพร้อมใช้งาน

6. **📱 รองรับ PWA & Mobile Web App**
   - ติดตั้งลงหน้าจอมือถือ (Android / iOS) เสมือน Native App
   - ใช้งานกล้องสแกน Barcode/QR Code ได้ทันทีบนสมาร์ตโฟน

---

### 🛠️ เทคโนโลยีที่ใช้ในการพัฒนา (Tech Stack)

| ส่วนของระบบ | เทคโนโลยีที่ใช้ |
| :--- | :--- |
| **Backend** | Python 3.10+, Flask 3.0.3, Gunicorn |
| **Database** | SQLite 3 (เปิดใช้งาน PRAGMA WAL Mode + Foreign Keys) |
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, CSS3 Custom Medical Theme (รองรับ Light/Dark Mode) |
| **Integrations** | LINE Messaging API SDK, Google APIs (Sheets API v4, Drive API v3, OAuth2) |
| **Computer Vision / OCR** | OpenCV (cv2), Pillow (PIL), NumPy |
| **Printing & QR** | QRCode.js, CSS Paged Media `@media print` |
| **Deployment** | Cloudflare Tunnel (Zero Trust), Docker |

---

### 🚀 วิธีการติดตั้งและเริ่มใช้งาน (Quick Start)

1. **Clone Repository**
   ```bash
   git clone https://github.com/MRAtommic/pharmacy_system.git
   cd pharmacy_system
   ```

2. **สร้าง Virtual Environment และติดตั้ง Dependencies**
   ```bash
   python -m venv venv
   # Windows:
   .\venv\Scripts\activate
   # macOS/Linux:
   source venv/bin/activate

   pip install -r requirements.txt
   ```

3. **ตั้งค่า Environment Variables (`.env`)**
   สร้างไฟล์ `.env` ในโฟลเดอร์หลัก:
   ```env
   PHARMACY_PORT=5005
   BASE_URL=http://localhost:5005
   LINE_CHANNEL_ACCESS_TOKEN=your_line_token_here
   LINE_CHANNEL_SECRET=your_line_secret_here
   EXPIRY_ALERT_DAYS=60
   ```

4. **รันเซิร์ฟเวอร์**
   ```bash
   python app.py
   ```
   เปิดเบราว์เซอร์ไปที่: `http://localhost:5005`

---
---

## 🇬🇧 English Version

### 📌 Project Overview
**PharmaCore RX-OS** is an intelligent, automated pharmacy stock management and clinical dispensing platform. Engineered specifically for clinics, dispensaries, and pharmacies to eliminate human errors, accelerate patient fulfillment, and streamline inventory control with **QR/Barcode scanning, automated LINE Messaging alerts, Google Workspace two-way synchronization, and customizable medical label printing.**

---

### ✨ Key Features

1. **📦 Master Drug Inventory & Lot Control**
   - Comprehensive drug profiles: generic name, trade name, strength, dosage form, batch/lot number, storage location, unit, and minimum thresholds.
   - Complete Stock-In receiving ledger with unit cost, total valuation, and supplier logs.

2. **⚡ Atomic Stock Dispensing & Fuzzy Search**
   - High-concurrency safe stock deductions with SQLite Write-Ahead Logging (WAL).
   - Instant drug lookup via hardware scanners, smartphone cameras, or Thai/English fuzzy text queries (e.g., "Para 2", "Amox 1").

3. **🖨️ Precision QR & Barcode Label Printer Engine**
   - Batch and single sticker printing with zero wasted margins.
   - Built-in presets: **A4 Micro (20x15mm), Mini (25x20mm), Compact, Thermal Rolls (25x15mm to 50x30mm)**, plus fully custom millimeter dimensions and up to 12 dynamic grid columns.

4. **⏰ 24/7 Expiry Alert Background Daemon**
   - Proactive tracking for expiring drugs (<30 days critical, <60 days warning).
   - Automated push notifications to designated LINE channels/pharmacists.

5. **☁️ Google Workspace Isolation & Excel Export**
   - Automatic background synchronization to **Google Sheets**.
   - Prescription & receipt photo archival to **Google Drive**.
   - Formatted `.xlsx` inventory export with one click.

6. **📱 Mobile Progressive Web App (PWA)**
   - Installable on Android & iOS home screens for native-app speed.
   - Integrated camera barcode scanner.

---

### 🛠️ Technology Stack

| Architecture Layer | Technologies |
| :--- | :--- |
| **Backend** | Python 3.10+, Flask 3.0.3, Gunicorn |
| **Database** | SQLite 3 (PRAGMA WAL Mode, Transaction-Safe) |
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, Pure CSS3 Medical Design System (Dark/Light Mode) |
| **APIs & Integrations** | LINE Messaging API, Google Sheets API v4, Google Drive API v3, OAuth2 |
| **Vision & Image Processing** | OpenCV (`opencv-python-headless`), Pillow (PIL), NumPy |
| **Print Engine** | QRCode.js, CSS Print Media Query Engine |
| **Networking & Deployment** | Cloudflare Tunnel, Docker |

---

### 📄 License
This project is open-source and available under the [MIT License](LICENSE).