"""
OCR & QR Code Recognition Service for Pharmacy System
Extracts drug codes from QR codes or scans prescriptions/labels using OCR + regex parsing.
"""

import re
import io
import os
try:
    import cv2
    import numpy as np
except ImportError:
    cv2 = None
    np = None
from PIL import Image
import database

def detect_code_from_image(image_bytes):
    """
    Attempt to read QR Code or 1D Barcode (EAN-13, Code-128, etc.) from image bytes using OpenCV.
    Returns: decoded_string or None
    """
    if not image_bytes:
        return None
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return None

        # 1. Try QR Code
        detector = cv2.QRCodeDetector()
        data, bbox, _ = detector.detectAndDecode(img)
        if data and data.strip():
            return data.strip()

        # 2. Try 1D Barcode (OpenCV BarcodeDetector)
        if hasattr(cv2, 'barcode') and hasattr(cv2.barcode, 'BarcodeDetector'):
            try:
                bd = cv2.barcode.BarcodeDetector()
                ok, decoded_info, decoded_type, corners = bd.detectAndDecode(img)
                if ok and decoded_info:
                    for val in decoded_info:
                        if val and val.strip():
                            return val.strip()
            except Exception:
                pass
    except Exception as e:
        print(f"Barcode/QR Detection error: {e}")
    return None

def detect_qr_code(image_bytes):
    """Alias for backwards compatibility."""
    return detect_code_from_image(image_bytes)

def extract_code_from_raw(raw_code):
    """Extract clean drug code from raw string, handling URLs and PHARM: prefixes."""
    if not raw_code:
        return ""
    code = raw_code.strip()
    if "http://" in code or "https://" in code:
        try:
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(code)
            qs = parse_qs(parsed.query)
            extracted = qs.get("scan", [None])[0] or qs.get("code", [None])[0] or qs.get("dispense", [None])[0]
            if extracted:
                code = extracted
            else:
                parts = [p for p in parsed.path.split('/') if p]
                if parts:
                    code = parts[-1]
        except Exception:
            pass
    return code.replace("PHARM:", "").strip()

def extract_text_from_image(image_bytes):
    """
    Extract text using pytesseract with Thai and English support.
    """
    if not image_bytes:
        return ""
    try:
        import pytesseract
        img = Image.open(io.BytesIO(image_bytes))
        
        # Try both thai and eng languages
        try:
            text = pytesseract.image_to_string(img, lang="tha+eng")
        except Exception:
            text = pytesseract.image_to_string(img)
        return text.strip()
    except Exception as e:
        print(f"Pytesseract error: {e}")
        return ""

def parse_drug_from_image(image_bytes):
    """
    High-level analyzer:
    1. Checks for QR code (fastest & most accurate).
    2. If QR found, parses payload (e.g. 'PHARM:MED-0001' or 'MED-0001').
    3. If no QR, runs OCR text extraction and searches for drug names and quantities.
    
    Returns:
    {
        "success": bool,
        "method": "QR_CODE" | "OCR_TEXT",
        "drug": dict or None,
        "quantity": int,
        "raw_data": str,
        "message": str
    }
    """
    # 1. Try QR Code or Barcode (Fastest & Most Accurate)
    scanned_payload = detect_code_from_image(image_bytes)
    if scanned_payload:
        code = extract_code_from_raw(scanned_payload)
        drug = database.get_drug_by_code(code) or database.find_drug_by_name_or_alias(code)
        if drug:
            return {
                "success": True,
                "method": "BARCODE_OR_QR",
                "drug": drug,
                "quantity": 1,
                "raw_data": scanned_payload,
                "message": f"สแกนพบคลังยา: {drug['name']} ({drug['code']})"
            }
        else:
            return {
                "success": False,
                "method": "BARCODE_OR_QR",
                "drug": None,
                "quantity": 1,
                "raw_data": scanned_payload,
                "message": f"สแกนพบบาร์โค้ด/QR Code ({scanned_payload}) แต่ยังไม่มีข้อมูลยานี้ในคลัง"
            }

    # 2. Try OCR
    raw_text = extract_text_from_image(image_bytes)
    if not raw_text:
        return {
            "success": False,
            "method": "NONE",
            "drug": None,
            "quantity": 1,
            "raw_data": "",
            "message": "ไม่พบ QR Code หรือข้อความที่อ่านได้จากภาพนี้"
        }

    # 3. Analyze text to match known drugs
    all_drugs = database.get_all_drugs()
    matched_drug = None
    detected_qty = 1

    # Check for quantity patterns (e.g. "จำนวน 2", "2 แผง", "2 เม็ด", "x 2", "Qty: 2")
    qty_patterns = [
        r'(?:จำนวน|qty|quantity)\s*[:=]?\s*(\d+)',
        r'(\d+)\s*(?:เม็ด|แคปซูล|แผง|ขวด|กล่อง|ซอง)',
        r'x\s*(\d+)',
        r'#\s*(\d+)'
    ]
    for pattern in qty_patterns:
        match = re.search(pattern, raw_text, re.IGNORECASE)
        if match:
            detected_qty = max(1, int(match.group(1)))
            break

    # Search for drug name in OCR text
    text_lower = raw_text.lower()
    for d in all_drugs:
        d_name = d["name"].lower()
        d_generic = (d.get("generic_name") or "").lower()
        d_code = d["code"].lower()

        if d_code in text_lower or (len(d_name) > 3 and d_name in text_lower) or (len(d_generic) > 3 and d_generic in text_lower):
            matched_drug = d
            break

    if matched_drug:
        return {
            "success": True,
            "method": "OCR_TEXT",
            "drug": matched_drug,
            "quantity": detected_qty,
            "raw_data": raw_text[:200],
            "message": f"AI OCR ตรวจพบชื่อยา: {matched_drug['name']} (จำนวน {detected_qty} {matched_drug['unit']})"
        }

    return {
        "success": False,
        "method": "OCR_TEXT",
        "drug": None,
        "quantity": detected_qty,
        "raw_data": raw_text[:200],
        "message": "อ่านข้อความจากภาพได้ แต่ไม่พบชื่อยาที่ตรงกับในคลังยา"
    }
