"""
LINE Bot Messaging Service for Pharmacy System
Handles text commands ('พารา 2'), photo OCR, and sends rich Medical Flex Messages.
"""

import re
import requests
import json
import logging
from config import Config
import database
from google_sync import google_sync
from ocr_service import parse_drug_from_image

logger = logging.getLogger("pharmacy_line")

class PharmacyLineBot:
    def __init__(self):
        self.access_token = Config.LINE_CHANNEL_ACCESS_TOKEN
        self.channel_secret = Config.LINE_CHANNEL_SECRET
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.access_token}"
        }

    def reply_message(self, reply_token, messages):
        """Send reply message to LINE user."""
        if not self.access_token:
            logger.warning("LINE_CHANNEL_ACCESS_TOKEN not configured.")
            return False

        url = "https://api.line.me/v2/bot/message/reply"
        payload = {
            "replyToken": reply_token,
            "messages": messages if isinstance(messages, list) else [messages]
        }
        try:
            res = requests.post(url, headers=self.headers, json=payload, timeout=10)
            return res.status_code == 200
        except Exception as e:
            logger.error(f"Error sending LINE reply: {e}")
            return False

    def push_message(self, to, messages):
        """Send push message to specific user ID or group ID."""
        if not self.access_token:
            logger.warning("LINE_CHANNEL_ACCESS_TOKEN not configured.")
            return False, "LINE_CHANNEL_ACCESS_TOKEN not configured"

        url = "https://api.line.me/v2/bot/message/push"
        payload = {
            "to": to,
            "messages": messages if isinstance(messages, list) else [messages]
        }
        try:
            res = requests.post(url, headers=self.headers, json=payload, timeout=12)
            if res.status_code == 200:
                return True, "OK"
            logger.error(f"LINE push failed ({res.status_code}): {res.text}")
            return False, res.text
        except Exception as e:
            logger.error(f"LINE push exception: {e}")
            return False, str(e)

    def broadcast_message(self, messages):
        """Broadcast message to all users who added the LINE Bot."""
        if not self.access_token:
            logger.warning("LINE_CHANNEL_ACCESS_TOKEN not configured.")
            return False, "LINE_CHANNEL_ACCESS_TOKEN not configured"

        url = "https://api.line.me/v2/bot/message/broadcast"
        payload = {
            "messages": messages if isinstance(messages, list) else [messages]
        }
        try:
            res = requests.post(url, headers=self.headers, json=payload, timeout=12)
            if res.status_code == 200:
                return True, "OK"
            logger.error(f"LINE broadcast failed ({res.status_code}): {res.text}")
            return False, res.text
        except Exception as e:
            logger.error(f"LINE broadcast exception: {e}")
            return False, str(e)

    def get_user_profile(self, user_id):
        """Fetch LINE user profile name."""
        if not self.access_token or not user_id or user_id in ("unknown", "None"):
            return None
        url = f"https://api.line.me/v2/bot/profile/{user_id}"
        try:
            res = requests.get(url, headers=self.headers, timeout=5)
            if res.status_code == 200:
                return res.json().get("displayName")
        except Exception:
            pass
        return None

    def get_message_content(self, message_id):
        """Download binary content (image/audio) from LINE."""
        url = f"https://api-data.line.me/v2/bot/message/{message_id}/content"
        try:
            res = requests.get(url, headers={"Authorization": f"Bearer {self.access_token}"}, timeout=15)
            if res.status_code == 200:
                return res.content
        except Exception as e:
            logger.error(f"Error downloading LINE content: {e}")
        return None

    def handle_webhook_event(self, event):
        """Process a single LINE event."""
        reply_token = event.get("replyToken")
        source = event.get("source", {})
        source_type = source.get("type", "user")
        user_id = source.get("userId", "unknown")
        target_id = source.get("groupId") or source.get("roomId") or user_id

        # Fetch display name
        display_name = ""
        if user_id and user_id != "unknown":
            display_name = self.get_user_profile(user_id) or "LINE User"
        else:
            display_name = "LINE Group/Room"

        # Auto-subscribe chatter for expiration alerts
        if target_id and target_id != "unknown":
            database.add_or_update_line_subscriber(target_id, target_type=source_type, display_name=display_name)

        event_type = event.get("type")

        # Handle follow event (user adds bot as friend)
        if event_type == "follow":
            if reply_token:
                self.reply_message(reply_token, {
                    "type": "text",
                    "text": f"🏥 สวัสดีค่ะคุณ {display_name} ยินดีต้อนรับสู่ระบบคลังยา PharmaCore!\n\n🔔 บัญชีของคุณได้รับการลงทะเบียนรับการแจ้งเตือนยาใกล้หมดอายุ (ภายใน 60 วัน) อัตโนมัติแล้วค่ะ\n\n💡 พิมพ์ 'เมนู' เพื่อดูคำสั่งทั้งหมด หรือพิมพ์ 'ยาใกล้หมดอายุ' เพื่อตรวจสอบรายการยาได้ทันทีค่ะ"
                })
            return

        if event_type == "join":
            if reply_token:
                self.reply_message(reply_token, {
                    "type": "text",
                    "text": "🏥 PharmaCore Bot เข้าร่วมกลุ่มเรียบร้อยแล้วค่ะ! กลุ่มนี้จะได้รับการแจ้งเตือนสต็อกและยาใกล้หมดอายุอัตโนมัติ พิมพ์ 'เมนู' เพื่อดูคำสั่งใช้งานนะคะ"
                })
            return

        message = event.get("message", {})
        msg_type = message.get("type")

        if msg_type == "text":
            text = message.get("text", "").strip()
            self._handle_text_message(reply_token, text, display_name, target_id)

        elif msg_type == "image":
            msg_id = message.get("id")
            self._handle_image_message(reply_token, msg_id, display_name, target_id=target_id)

    def _handle_text_message(self, reply_token, text, user_name, target_id=None):
        """Parse text for deduction, stock query, expiry check, or menu."""
        lower_text = text.lower()

        # 1. Menu / Help
        if lower_text in ["เมนู", "help", "คำสั่ง", "?"]:
            flex = self._create_menu_flex()
            self.reply_message(reply_token, flex)
            return

        # 2. Check stock list or low stock
        if lower_text in ["เช็คสต็อก", "สต็อก", "stock"]:
            flex = self._create_stock_summary_flex()
            self.reply_message(reply_token, flex)
            return

        if lower_text in ["ยาหมด", "เตือน", "ใกล้หมด"]:
            low_drugs = database.get_all_drugs(low_stock_only=True)
            if not low_drugs:
                self.reply_message(reply_token, {"type": "text", "text": "✅ ขณะนี้สต็อกยาทุกรายการอยู่ในเกณฑ์ปกติ ไม่มีรายการยาที่ต้องสั่งซื้อด่วนค่ะ"})
            else:
                msg = "⚠️ รายการยาที่ใกล้หมดสต็อก:\n"
                for d in low_drugs[:10]:
                    msg += f"• {d['name']}: เหลือ {d['stock_qty']} {d['unit']} (จุดเตือน {d['min_threshold']})\n"
                self.reply_message(reply_token, {"type": "text", "text": msg.strip()})
            return

        # 3. Check Expiring Drugs (60 days)
        if any(k in lower_text for k in ["ยาใกล้หมดอายุ", "เช็ควันหมดอายุ", "วันหมดอายุ", "ใกล้หมดอายุ", "หมดอายุ", "exp", "expiry"]):
            days = Config.EXPIRY_ALERT_DAYS or 60
            expiring = database.get_expiring_drugs(days=days)
            if not expiring:
                self.reply_message(reply_token, {
                    "type": "text",
                    "text": f"✅ ตรวจสอบคลังยาเรียบร้อย: ขณะนี้ไม่พบรายการยาที่หมดอายุหรือใกล้หมดอายุภายใน {days} วันค่ะ 🏥✨"
                })
            else:
                flex = self._create_expiry_alert_flex(expiring, days=days)
                self.reply_message(reply_token, flex)
            return

        # 4. Subscribe for alerts command
        if lower_text in ["เปิดแจ้งเตือน", "รับแจ้งเตือน", "subscribe", "alert on"]:
            if target_id and target_id != "unknown":
                database.add_or_update_line_subscriber(target_id, display_name=user_name)
                database.set_app_setting("line_notify_target", target_id)
                self.reply_message(reply_token, {
                    "type": "text",
                    "text": f"🔔 บันทึกการเปิดรับแจ้งเตือนเรียบร้อยแล้วค่ะ!\nระบบจะแจ้งเตือนเมื่อมียาใกล้หมดอายุ (ภายใน 60 วัน) ส่งตรงถึงแชทนี้อัตโนมัติค่ะ 🏥"
                })
            return

        # 5. Download / Install APK or PWA App
        if lower_text in ["app", "apk", "ติดตั้งแอป", "โหลดแอป", "แอพ", "ติดตั้ง", "download"]:
            flex = self._create_apk_download_flex()
            self.reply_message(reply_token, flex)
            return

        # 3. Deduction Pattern: [ชื่อยา/รหัสยา] [จำนวน] (e.g., 'พารา 2' หรือ 'Amox 1')
        match = re.match(r"^(.+?)\s*([xX*+-]?)\s*(\d+)\s*(?:เม็ด|แคปซูล|ขวด|แผง|กล่อง|ซอง)?$", text)
        if match:
            drug_query = match.group(1).strip()
            qty = int(match.group(3))

            drug = database.find_drug_by_name_or_alias(drug_query)
            if not drug:
                self.reply_message(reply_token, {
                    "type": "text",
                    "text": f"❌ ไม่พบยาชื่อ '{drug_query}' ในระบบคลังยาค่ะ\n\n💡 พิมพ์ 'เช็คสต็อก' เพื่อดูรายชื่อยาทั้งหมด หรือสแกน QR Code เพื่อตัดสต็อกได้ค่ะ"
                })
                return

            # Deduct stock
            success, result = database.deduct_stock(
                drug["id"],
                qty,
                channel="LINE_TEXT",
                dispensed_by=user_name,
                notes=f"ตัดผ่านข้อความ LINE: '{text}'"
            )

            if success:
                # Sync to Google Sheets
                google_sync.append_dispensing_log(result)
                google_sync.sync_all_drugs_to_sheet(database.get_all_drugs())

                flex = self._create_deduct_success_flex(result)
                self.reply_message(reply_token, flex)

                # Broadcast stock movement alert to all other subscribers
                import threading
                threading.Thread(target=self.send_dispense_notification, args=(result,), kwargs={"exclude_target": target_id}, daemon=True).start()
            else:
                self.reply_message(reply_token, {"type": "text", "text": f"⚠️ ไม่สามารถตัดสต็อกได้: {result}"})
            return

        # Query single drug (e.g., 'ค้นหา พารา')
        drug = database.find_drug_by_name_or_alias(text)
        if drug:
            flex = self._create_drug_card_flex(drug)
            self.reply_message(reply_token, flex)
            return

        # Fallback helpful response
        self.reply_message(reply_token, {
            "type": "text",
            "text": f"🏥 ระบบคลังยาได้รับข้อความ: '{text}'\n\nต้องการตัดสต็อกยา กรุณาพิมพ์ [ชื่อยา] ตามด้วย [จำนวน]\nเช่น:\n👉 พารา 2\n👉 Amoxicillin 1\n\nหรือส่งรูปภาพฉลากยา/QR Code เข้ามาได้เลยค่ะ"
        })

    def _handle_image_message(self, reply_token, msg_id, user_name, target_id=None):
        """Process uploaded image (prescription / QR / drug bag)."""
        image_bytes = self.get_message_content(msg_id)
        if not image_bytes:
            self.reply_message(reply_token, {"type": "text", "text": "❌ ไม่สามารถดาวน์โหลดรูปภาพจาก LINE ได้ กรุณาลองใหม่อีกครั้งค่ะ"})
            return

        # Run OCR & QR analysis
        analysis = parse_drug_from_image(image_bytes)
        
        if not analysis.get("success") or not analysis.get("drug"):
            self.reply_message(reply_token, {
                "type": "text",
                "text": f"🔍 {analysis.get('message', 'ไม่สามารถระบุชื่อยาจากภาพได้')}\n\nกรุณาพิมพ์ชื่อยาและจำนวนด้วยข้อความ เช่น 'พารา 2' เพื่อตัดสต็อกแทนค่ะ"
            })
            return

        drug = analysis["drug"]
        qty = analysis.get("quantity", 1)
        method = analysis.get("method", "OCR")

        # Upload image to Google Drive dedicated folder
        drive_file_id, drive_file_link = google_sync.upload_image_to_drive(
            image_bytes,
            f"{drug['code']}_{msg_id}.jpg",
            mime_type="image/jpeg"
        )

        # Deduct stock
        success, result = database.deduct_stock(
            drug["id"],
            qty,
            channel=f"LINE_{method}",
            dispensed_by=user_name,
            drive_file_id=drive_file_id,
            drive_file_link=drive_file_link,
            notes=f"ตัดจากภาพ ({method}): {analysis.get('message')}"
        )

        if success:
            # Sync to Google Sheets
            google_sync.append_dispensing_log(result)
            google_sync.sync_all_drugs_to_sheet(database.get_all_drugs())

            flex = self._create_deduct_success_flex(result, method=method, drive_link=drive_file_link)
            self.reply_message(reply_token, flex)

            # Broadcast stock movement alert to all other subscribers
            import threading
            threading.Thread(target=self.send_dispense_notification, args=(result,), kwargs={"exclude_target": target_id}, daemon=True).start()
        else:
            self.reply_message(reply_token, {"type": "text", "text": f"⚠️ ไม่สามารถตัดสต็อกได้: {result}"})

    # ─────────────────────────────────────────────────────────────
    # Flex Messages (Clean Medical Design)
    # ─────────────────────────────────────────────────────────────

    def _format_channel_label(self, channel_code):
        mapping = {
            "WEB_MANUAL": "💻 บันทึกผ่านหน้าเว็บ",
            "QR_SCAN": "📷 สแกน QR Code",
            "BARCODE_SCAN": "📟 สแกนบาร์โค้ด",
            "SCANNER": "📷 สแกนเนอร์",
            "LINE_TEXT": "💬 ข้อความ LINE Bot",
            "LINE_OCR": "📷 สแกนภาพ/OCR (LINE)",
        }
        return mapping.get(str(channel_code).upper(), str(channel_code) if channel_code else "ระบบคลัง")

    def _create_dispense_alert_flex(self, data, drive_link=None):
        """Clean, minimal card matching approved OrgChat design in media_1790770187611.png."""
        primary_color = "#E05263"  # Soft Rose Red (user-approved tone)
        header_title = "บันทึกตัดสต็อกยา"
        header_sub = "ระบบคลังยา · อัปเดตสต็อกล่าสุด"

        drug_name = data.get("drug_name", "รายการยา")
        drug_code = data.get("drug_code", "-")
        category = data.get("category", "ยาสามัญ")
        qty = data.get("quantity", 1)
        unit = data.get("unit", "หน่วย")
        balance_after = data.get("balance_after", 0)
        location = data.get("location", "ตู้ยาคลินิก")
        is_low = data.get("is_low_stock", False)

        channel_raw = data.get("channel", "WEB_MANUAL")
        channel_text = "สแกน QR Code" if ("QR" in str(channel_raw).upper() or "SCAN" in str(channel_raw).upper()) else "ระบบหน้าเว็บ"
        if "LINE" in str(channel_raw).upper():
            channel_text = "LINE Bot"

        dispensed_by = data.get("dispensed_by") or channel_text
        patient_name = data.get("patient_name", "").strip()

        # Status Badge (Soft Pill Style matching media_1790770187611.png)
        badge_bg = "#FEE2E2"
        badge_color = "#DC2626"
        badge_text = f"-{qty} {unit}"
        if is_low:
            badge_text = f"-{qty} (ใกล้หมด)"

        sub_info = f"{drug_code} · {category}" if category and category != "-" else f"{drug_code} · {unit}"
        loc_str = f" (จัดเก็บ: {location})" if location and location != "-" else ""
        remaining_str = f"{balance_after} {unit}{loc_str}"

        operator_str = channel_text
        if patient_name:
            operator_str += f" (คนไข้: {patient_name})"
        elif dispensed_by and dispensed_by not in ("เจ้าหน้าที่", "เภสัชกร/เจ้าหน้าที่", channel_text):
            operator_str += f" โดย {dispensed_by}"

        # 📸 Drug Photo integration
        img_box = self._format_flex_image(data.get("image_url"))
        if not img_box and data.get("drug_id"):
            try:
                d_info = database.get_drug_by_id(data["drug_id"])
                if d_info and d_info.get("image_url"):
                    img_box = self._format_flex_image(d_info.get("image_url"))
            except Exception:
                pass

        card_contents = []
        if img_box:
            card_contents.append(img_box)

        card_contents.extend([
            # Line 1: Drug Name
            {
                "type": "text",
                "text": drug_name,
                "weight": "bold",
                "size": "sm",
                "color": "#0F172A",
                "wrap": True
            },
            # Line 2: Subtitle + Badge on same row
            {
                "type": "box",
                "layout": "horizontal",
                "margin": "xs",
                "contents": [
                    {
                        "type": "text",
                        "text": sub_info,
                        "size": "xxs",
                        "color": "#94A3B8",
                        "flex": 7,
                        "wrap": True
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "backgroundColor": badge_bg,
                        "cornerRadius": "6px",
                        "paddingStart": "8px",
                        "paddingEnd": "8px",
                        "paddingTop": "2px",
                        "paddingBottom": "2px",
                        "contents": [
                            {
                                "type": "text",
                                "text": badge_text,
                                "size": "xxs",
                                "weight": "bold",
                                "color": badge_color,
                                "align": "center"
                            }
                        ],
                        "flex": 4
                    }
                ],
                "alignItems": "center"
            },
            # Line 3: คงเหลือในคลัง
            {
                "type": "box",
                "layout": "baseline",
                "margin": "sm",
                "contents": [
                    {"type": "text", "text": "คงเหลือในคลัง", "size": "xs", "color": "#64748B", "flex": 4},
                    {"type": "text", "text": remaining_str, "size": "xs", "color": "#0F172A", "weight": "bold", "flex": 8}
                ]
            },
            # Line 4: ช่องทาง / ผู้ตัดจ่าย
            {
                "type": "box",
                "layout": "baseline",
                "margin": "xs",
                "contents": [
                    {"type": "text", "text": "การทำรายการ", "size": "xs", "color": "#64748B", "flex": 4},
                    {"type": "text", "text": operator_str, "size": "xs", "color": "#334155", "flex": 8}
                ]
            }
        ])

        drug_card = {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#F8FAFC",
            "cornerRadius": "10px",
            "paddingAll": "12px",
            "borderColor": "#E2E8F0",
            "borderWidth": "1px",
            "contents": card_contents
        }

        body_contents = [
            drug_card,
            {"type": "separator", "margin": "lg", "color": "#F3F4F6"},
            {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {
                        "type": "box",
                        "layout": "vertical",
                        "contents": [
                            {"type": "text", "text": "Rx", "color": "#ffffff", "size": "xs", "align": "center", "weight": "bold"}
                        ],
                        "width": "28px",
                        "height": "28px",
                        "backgroundColor": primary_color,
                        "cornerRadius": "14px",
                        "justifyContent": "center",
                        "alignItems": "center"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "contents": [
                            {"type": "text", "text": "PharmaCore Inventory", "size": "xs", "color": "#111827", "weight": "bold"},
                            {"type": "text", "text": "บันทึกตัดสต็อกเรียบร้อย", "size": "xxs", "color": "#9CA3AF"}
                        ],
                        "paddingStart": "10px"
                    }
                ],
                "alignItems": "center",
                "margin": "lg"
            }
        ]

        footer_buttons = [
            {
                "type": "button",
                "action": {
                    "type": "uri",
                    "label": "เปิดจัดการคลังยาบนเว็บ",
                    "uri": Config.BASE_URL
                },
                "style": "primary",
                "color": primary_color,
                "height": "sm"
            }
        ]

        effective_drive_link = drive_link or data.get("drive_file_link")
        if effective_drive_link:
            footer_buttons.append({
                "type": "button",
                "action": {
                    "type": "uri",
                    "label": "ดูรูปหลักฐานบน Google Drive",
                    "uri": effective_drive_link
                },
                "style": "secondary",
                "height": "sm",
                "margin": "sm"
            })

        flex_contents = {
            "type": "bubble",
            "size": "mega",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": primary_color,
                "paddingAll": "16px",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    {"type": "text", "text": "💊", "size": "xl", "align": "center"}
                                ],
                                "width": "42px",
                                "height": "42px",
                                "backgroundColor": "#ffffff20",
                                "cornerRadius": "12px",
                                "justifyContent": "center",
                                "alignItems": "center"
                            },
                            {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    {"type": "text", "text": header_title, "color": "#ffffff", "size": "md", "weight": "bold", "wrap": True},
                                    {"type": "text", "text": header_sub, "color": "#ffffff90", "size": "xxs"}
                                ],
                                "paddingStart": "12px"
                            }
                        ],
                        "alignItems": "center"
                    }
                ]
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#FFFFFF",
                "paddingAll": "18px",
                "spacing": "sm",
                "contents": body_contents
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#F9FAFB",
                "paddingAll": "14px",
                "contents": footer_buttons
            }
        }

        return {
            "type": "flex",
            "altText": f"💊 ตัดสต็อก: {drug_name} (-{qty} {unit}) คงเหลือ {balance_after} {unit}",
            "contents": flex_contents
        }

    def _format_flex_image(self, image_url):
        """Format drug photo as a clean LINE Flex component matching OrgChat social posts."""
        if not image_url or not str(image_url).strip():
            return None
        clean = str(image_url).strip()
        full_url = clean if (clean.startswith("http://") or clean.startswith("https://")) else f"{Config.BASE_URL}{clean}"
        full_url = full_url.replace("http://", "https://")
        return {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "image",
                    "url": full_url,
                    "size": "full",
                    "aspectRatio": "16:9",
                    "aspectMode": "cover",
                    "action": {
                        "type": "uri",
                        "label": "ดูรูปภาพยาเต็ม",
                        "uri": full_url
                    }
                }
            ],
            "cornerRadius": "8px"
        }

    def _create_stock_in_alert_flex(self, data):
        """Rich Flex Message for Stock In / Receiving notification."""
        primary_color = "#059669"  # Emerald Green
        header_title = "รับยาเข้าสต็อก"
        header_sub = "ระบบคลังยา · เพิ่มสต็อกเข้าคลัง"

        drug_name = data.get("drug_name", "รายการยา")
        drug_code = data.get("drug_code", "-")
        lot_number = data.get("lot_number", "").strip()
        qty = data.get("quantity", 0)
        unit = data.get("unit", "หน่วย")
        balance_before = data.get("balance_before", 0)
        balance_after = data.get("balance_after", 0)
        expiry_date = data.get("expiry_date", "").strip()
        supplier = data.get("supplier", "").strip()
        received_by = data.get("received_by", "เจ้าหน้าที่").strip()

        img_box = self._format_flex_image(data.get("image_url"))
        if not img_box and data.get("drug_id"):
            try:
                d_info = database.get_drug_by_id(data["drug_id"])
                if d_info and d_info.get("image_url"):
                    img_box = self._format_flex_image(d_info.get("image_url"))
            except Exception:
                pass

        card_contents = []
        if img_box:
            card_contents.append(img_box)

        sub_info = f"{drug_code} · ล็อต: {lot_number}" if lot_number else drug_code

        card_contents.extend([
            # Line 1: Drug Name
            {
                "type": "text",
                "text": drug_name,
                "weight": "bold",
                "size": "sm",
                "color": "#0F172A",
                "wrap": True
            },
            # Line 2: Subtitle + Green Badge (+100 เม็ด)
            {
                "type": "box",
                "layout": "horizontal",
                "margin": "xs",
                "contents": [
                    {
                        "type": "text",
                        "text": sub_info,
                        "size": "xxs",
                        "color": "#94A3B8",
                        "flex": 7,
                        "wrap": True
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "backgroundColor": "#ECFDF5",
                        "cornerRadius": "6px",
                        "paddingStart": "8px",
                        "paddingEnd": "8px",
                        "paddingTop": "2px",
                        "paddingBottom": "2px",
                        "contents": [
                            {
                                "type": "text",
                                "text": f"+{qty} {unit}",
                                "size": "xxs",
                                "weight": "bold",
                                "color": "#059669",
                                "align": "center"
                            }
                        ],
                        "flex": 4
                    }
                ],
                "alignItems": "center"
            },
            # Line 3: ยอดสต็อก ก่อน -> หลัง
            {
                "type": "box",
                "layout": "baseline",
                "margin": "sm",
                "contents": [
                    {"type": "text", "text": "ยอดสต็อก", "size": "xs", "color": "#64748B", "flex": 4},
                    {"type": "text", "text": f"{balance_before} ➔ {balance_after} {unit}", "size": "xs", "color": "#0F172A", "weight": "bold", "flex": 8}
                ]
            }
        ])

        if expiry_date:
            card_contents.append({
                "type": "box",
                "layout": "baseline",
                "margin": "xs",
                "contents": [
                    {"type": "text", "text": "วันหมดอายุ", "size": "xs", "color": "#64748B", "flex": 4},
                    {"type": "text", "text": expiry_date, "size": "xs", "color": "#334155", "flex": 8}
                ]
            })

        supplier_str = f"โดย {received_by}"
        if supplier and supplier != "-":
            supplier_str += f" ({supplier})"

        card_contents.append({
            "type": "box",
            "layout": "baseline",
            "margin": "xs",
            "contents": [
                {"type": "text", "text": "ผู้ตรวจรับ", "size": "xs", "color": "#64748B", "flex": 4},
                {"type": "text", "text": supplier_str, "size": "xs", "color": "#334155", "flex": 8}
            ]
        })

        drug_card = {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#F8FAFC",
            "cornerRadius": "10px",
            "paddingAll": "12px",
            "borderColor": "#E2E8F0",
            "borderWidth": "1px",
            "contents": card_contents
        }

        body_contents = [
            drug_card,
            {"type": "separator", "margin": "lg", "color": "#F3F4F6"},
            {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {
                        "type": "box",
                        "layout": "vertical",
                        "contents": [
                            {"type": "text", "text": "Rx", "color": "#ffffff", "size": "xs", "align": "center", "weight": "bold"}
                        ],
                        "width": "28px",
                        "height": "28px",
                        "backgroundColor": primary_color,
                        "cornerRadius": "14px",
                        "justifyContent": "center",
                        "alignItems": "center"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "contents": [
                            {"type": "text", "text": "PharmaCore Inventory", "size": "xs", "color": "#111827", "weight": "bold"},
                            {"type": "text", "text": "บันทึกรับยาเข้าเรียบร้อย", "size": "xxs", "color": "#9CA3AF"}
                        ],
                        "paddingStart": "10px"
                    }
                ],
                "alignItems": "center",
                "margin": "lg"
            }
        ]

        flex_contents = {
            "type": "bubble",
            "size": "mega",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": primary_color,
                "paddingAll": "16px",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    {"type": "text", "text": "📥", "size": "xl", "align": "center"}
                                ],
                                "width": "42px",
                                "height": "42px",
                                "backgroundColor": "#ffffff20",
                                "cornerRadius": "12px",
                                "justifyContent": "center",
                                "alignItems": "center"
                            },
                            {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    {"type": "text", "text": header_title, "color": "#ffffff", "size": "md", "weight": "bold", "wrap": True},
                                    {"type": "text", "text": header_sub, "color": "#ffffff90", "size": "xxs"}
                                ],
                                "paddingStart": "12px"
                            }
                        ],
                        "alignItems": "center"
                    }
                ]
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#FFFFFF",
                "paddingAll": "18px",
                "spacing": "sm",
                "contents": body_contents
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#F9FAFB",
                "paddingAll": "14px",
                "contents": [
                    {
                        "type": "button",
                        "action": {
                            "type": "uri",
                            "label": "เปิดจัดการคลังยาบนเว็บ",
                            "uri": Config.BASE_URL
                        },
                        "style": "primary",
                        "color": primary_color,
                        "height": "sm"
                    }
                ]
            }
        }

        return {
            "type": "flex",
            "altText": f"📥 รับยาเข้าสต็อก: {drug_name} (+{qty} {unit}) ยอดคงเหลือ {balance_after} {unit}",
            "contents": flex_contents
        }

    def _create_new_drug_alert_flex(self, drug):
        """Rich Flex Message for New Drug Registration notification."""
        primary_color = "#2563EB"  # Enterprise Medical Blue
        header_title = "เพิ่มยาใหม่เข้าคลัง"
        header_sub = "ระบบคลังยา · ทะเบียนยาใหม่"

        drug_name = drug.get("name", "ยาใหม่")
        drug_code = drug.get("code", "-")
        category = drug.get("category", "ทั่วไป")
        stock_qty = drug.get("stock_qty", 0)
        unit = drug.get("unit", "หน่วย")
        location = drug.get("location", "ตู้ยาคลินิก")
        price = drug.get("price", 0)
        img_box = self._format_flex_image(drug.get("image_url"))

        card_contents = []
        if img_box:
            card_contents.append(img_box)

        sub_info = f"{drug_code} · {category}"

        card_contents.extend([
            # Line 1: Drug Name
            {
                "type": "text",
                "text": drug_name,
                "weight": "bold",
                "size": "sm",
                "color": "#0F172A",
                "wrap": True
            },
            # Line 2: Subtitle + Badge สต็อกเริ่มต้น
            {
                "type": "box",
                "layout": "horizontal",
                "margin": "xs",
                "contents": [
                    {
                        "type": "text",
                        "text": sub_info,
                        "size": "xxs",
                        "color": "#94A3B8",
                        "flex": 7,
                        "wrap": True
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "backgroundColor": "#EFF6FF",
                        "cornerRadius": "6px",
                        "paddingStart": "8px",
                        "paddingEnd": "8px",
                        "paddingTop": "2px",
                        "paddingBottom": "2px",
                        "contents": [
                            {
                                "type": "text",
                                "text": f"{stock_qty} {unit}",
                                "size": "xxs",
                                "weight": "bold",
                                "color": "#2563EB",
                                "align": "center"
                            }
                        ],
                        "flex": 4
                    }
                ],
                "alignItems": "center"
            },
            # Line 3: ตำแหน่งจัดเก็บ
            {
                "type": "box",
                "layout": "baseline",
                "margin": "sm",
                "contents": [
                    {"type": "text", "text": "ตำแหน่งจัดเก็บ", "size": "xs", "color": "#64748B", "flex": 4},
                    {"type": "text", "text": location, "size": "xs", "color": "#0F172A", "weight": "bold", "flex": 8}
                ]
            }
        ])

        if price and float(price) > 0:
            card_contents.append({
                "type": "box",
                "layout": "baseline",
                "margin": "xs",
                "contents": [
                    {"type": "text", "text": "ราคาจำหน่าย", "size": "xs", "color": "#64748B", "flex": 4},
                    {"type": "text", "text": f"฿{float(price):,.2f} / {unit}", "size": "xs", "color": "#059669", "weight": "bold", "flex": 8}
                ]
            })

        drug_card = {
            "type": "box",
            "layout": "vertical",
            "backgroundColor": "#F8FAFC",
            "cornerRadius": "10px",
            "paddingAll": "12px",
            "borderColor": "#E2E8F0",
            "borderWidth": "1px",
            "contents": card_contents
        }

        body_contents = [
            drug_card,
            {"type": "separator", "margin": "lg", "color": "#F3F4F6"},
            {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {
                        "type": "box",
                        "layout": "vertical",
                        "contents": [
                            {"type": "text", "text": "Rx", "color": "#ffffff", "size": "xs", "align": "center", "weight": "bold"}
                        ],
                        "width": "28px",
                        "height": "28px",
                        "backgroundColor": primary_color,
                        "cornerRadius": "14px",
                        "justifyContent": "center",
                        "alignItems": "center"
                    },
                    {
                        "type": "box",
                        "layout": "vertical",
                        "contents": [
                            {"type": "text", "text": "PharmaCore Inventory", "size": "xs", "color": "#111827", "weight": "bold"},
                            {"type": "text", "text": "ลงทะเบียนยาใหม่เรียบร้อย", "size": "xxs", "color": "#9CA3AF"}
                        ],
                        "paddingStart": "10px"
                    }
                ],
                "alignItems": "center",
                "margin": "lg"
            }
        ]

        flex_contents = {
            "type": "bubble",
            "size": "mega",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": primary_color,
                "paddingAll": "16px",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    {"type": "text", "text": "✨", "size": "xl", "align": "center"}
                                ],
                                "width": "42px",
                                "height": "42px",
                                "backgroundColor": "#ffffff20",
                                "cornerRadius": "12px",
                                "justifyContent": "center",
                                "alignItems": "center"
                            },
                            {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    {"type": "text", "text": header_title, "color": "#ffffff", "size": "md", "weight": "bold", "wrap": True},
                                    {"type": "text", "text": header_sub, "color": "#ffffff90", "size": "xxs"}
                                ],
                                "paddingStart": "12px"
                            }
                        ],
                        "alignItems": "center"
                    }
                ]
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#FFFFFF",
                "paddingAll": "18px",
                "spacing": "sm",
                "contents": body_contents
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#F9FAFB",
                "paddingAll": "14px",
                "contents": [
                    {
                        "type": "button",
                        "action": {
                            "type": "uri",
                            "label": "เปิดจัดการคลังยาบนเว็บ",
                            "uri": Config.BASE_URL
                        },
                        "style": "primary",
                        "color": primary_color,
                        "height": "sm"
                    }
                ]
            }
        }

        return {
            "type": "flex",
            "altText": f"✨ เพิ่มยาใหม่: {drug_name} ({drug_code}) สต็อกเริ่มต้น {stock_qty} {unit}",
            "contents": flex_contents
        }

    def _create_deduct_success_flex(self, data, method="ข้อความ", drive_link=None):
        """Backward compatible wrapper."""
        return self._create_dispense_alert_flex(data, drive_link=drive_link)

    def _create_menu_flex(self):
        """Clinical menu flex message."""
        return {
            "type": "flex",
            "altText": "เมนูระบบคลังยา",
            "contents": {
                "type": "bubble",
                "header": {
                    "type": "box",
                    "layout": "vertical",
                    "backgroundColor": "#0D9488",
                    "contents": [
                        {"type": "text", "text": "🏥 ระบบจัดการคลังยาอัตโนมัติ", "weight": "bold", "color": "#FFFFFF", "size": "md"},
                        {"type": "text", "text": "LINE Stock & Dispensing Bot", "color": "#CCFBF1", "size": "xs", "margin": "xs"}
                    ]
                },
                "body": {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        {"type": "text", "text": "💡 วิธีการใช้งาน:", "weight": "bold", "color": "#0F172A"},
                        {"type": "text", "text": "1. พิมพ์ [ชื่อยา] [จำนวน] เพื่อตัดสต็อก\n   เช่น 'พารา 2' หรือ 'Amox 1'", "size": "xs", "color": "#475569", "margin": "md", "wrap": True},
                        {"type": "text", "text": "2. ส่งรูปภาพซองยา / ฉลากยา / QR code เพื่อให้ AI อ่านและตัดสต็อกอัตโนมัติ", "size": "xs", "color": "#475569", "margin": "sm", "wrap": True},
                        {"type": "text", "text": "3. พิมพ์ 'เช็คสต็อก' เพื่อดูรายการยาทั้งหมด", "size": "xs", "color": "#475569", "margin": "sm", "wrap": True},
                        {"type": "text", "text": "4. พิมพ์ 'ยาหมด' เพื่อดูยาที่ต้องสั่งซื้อด่วน", "size": "xs", "color": "#475569", "margin": "sm", "wrap": True},
                        {"type": "text", "text": "5. พิมพ์ 'ยาใกล้หมดอายุ' เพื่อตรวจเช็คยาที่ใกล้หมดอายุใน 60 วัน", "size": "xs", "color": "#E11D48", "weight": "bold", "margin": "sm", "wrap": True},
                        {"type": "text", "text": "6. พิมพ์ 'เปิดแจ้งเตือน' เพื่อรับการแจ้งเตือนอัตโนมัติที่แชทนี้", "size": "xs", "color": "#0D9488", "margin": "sm", "wrap": True},
                        {"type": "text", "text": "7. พิมพ์ 'ติดตั้งแอป' หรือ 'apk' เพื่อติดตั้งแอปลงมือถือทันที", "size": "xs", "color": "#10B981", "weight": "bold", "margin": "sm", "wrap": True}
                    ]
                },
                "footer": {
                    "type": "box",
                    "layout": "vertical",
                    "spacing": "sm",
                    "contents": [
                        {
                            "type": "button",
                            "action": {"type": "uri", "label": "💻 เข้าสู่ระบบหน้าเว็บ", "uri": Config.BASE_URL},
                            "style": "primary",
                            "color": "#0D9488"
                        },
                        {
                            "type": "button",
                            "action": {"type": "uri", "label": "📱 ติดตั้งแอปมือถือ (APK / PWA)", "uri": f"{Config.BASE_URL}?install=apk"},
                            "style": "secondary"
                        }
                    ]
                }
            }
        }

    def _create_apk_download_flex(self):
        """Card for installing PharmaCore Mobile App (APK / PWA)."""
        app_url = f"{Config.BASE_URL}?install=apk"
        icon_url = f"{Config.BASE_URL}/static/icons/icon-192.png".replace("http://", "https://")
        return {
            "type": "flex",
            "altText": "📱 ติดตั้งแอป PharmaCore บนมือถือ (APK / PWA)",
            "contents": {
                "type": "bubble",
                "header": {
                    "type": "box",
                    "layout": "horizontal",
                    "backgroundColor": "#10B981",
                    "paddingAll": "16px",
                    "contents": [
                        {
                            "type": "image",
                            "url": icon_url,
                            "size": "48px",
                            "aspectRatio": "1:1",
                            "aspectMode": "cover",
                            "flex": 0
                        },
                        {
                            "type": "box",
                            "layout": "vertical",
                            "margin": "md",
                            "contents": [
                                {"type": "text", "text": "PharmaCore Mobile", "weight": "bold", "color": "#FFFFFF", "size": "md"},
                                {"type": "text", "text": "แอปพลิเคชันคลังยา (APK / PWA)", "color": "#D1FAE5", "size": "xs", "margin": "xs"}
                            ]
                        }
                    ]
                },
                "body": {
                    "type": "box",
                    "layout": "vertical",
                    "paddingAll": "16px",
                    "contents": [
                        {"type": "text", "text": "✨ ติดตั้งลงหน้าจอมือถือใช้งานได้ทันที:", "weight": "bold", "color": "#0F172A", "size": "sm"},
                        {"type": "text", "text": "• ใช้งานเหมือนแอป Native ทันที\n• สแกนบาร์โค้ดผ่านกล้องมือถือได้ลื่นไหล\n• แจ้งเตือนยาใกล้หมดอายุ & รับเข้าคลังเรียลไทม์\n• ติดตั้งได้ทั้ง Android และ iPhone", "size": "xs", "color": "#475569", "margin": "sm", "wrap": True}
                    ]
                },
                "footer": {
                    "type": "box",
                    "layout": "vertical",
                    "paddingAll": "16px",
                    "contents": [
                        {
                            "type": "button",
                            "action": {"type": "uri", "label": "📲 แตะเพื่อติดตั้งแอปลงมือถือ", "uri": app_url},
                            "style": "primary",
                            "color": "#10B981"
                        }
                    ]
                }
            }
        }


    def _create_stock_summary_flex(self):
        """Returns top 5 stock summary."""
        drugs = database.get_all_drugs()[:8]
        rows = []
        for d in drugs:
            is_low = d["stock_qty"] <= d["min_threshold"]
            rows.append({
                "type": "box",
                "layout": "horizontal",
                "contents": [
                    {"type": "text", "text": d["name"], "size": "xs", "weight": "bold", "color": "#1E293B", "flex": 3, "wrap": False},
                    {"type": "text", "text": f"{d['stock_qty']} {d['unit']}", "size": "xs", "color": "#EF4444" if is_low else "#0F766E", "weight": "bold", "align": "end", "flex": 2}
                ]
            })

        return {
            "type": "flex",
            "altText": "สรุปสต็อกยาคงเหลือ",
            "contents": {
                "type": "bubble",
                "header": {
                    "type": "box",
                    "layout": "vertical",
                    "backgroundColor": "#0F766E",
                    "contents": [
                        {"type": "text", "text": "📦 สรุปสต็อกยาคงเหลือ", "weight": "bold", "color": "#FFFFFF", "size": "md"}
                    ]
                },
                "body": {
                    "type": "box",
                    "layout": "vertical",
                    "spacing": "md",
                    "contents": rows if rows else [{"type": "text", "text": "ไม่มีข้อมูลยาในระบบ"}]
                },
                "footer": {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        {"type": "button", "action": {"type": "uri", "label": "ดูคลังยาทั้งหมด", "uri": Config.BASE_URL}, "style": "primary", "color": "#0F766E"}
                    ]
                }
            }
        }

    def _create_drug_card_flex(self, d):
        """Single drug info card."""
        is_low = d["stock_qty"] <= d["min_threshold"]
        img_box = self._format_flex_image(d.get("image_url"))
        
        body_contents = []
        if img_box:
            body_contents.append(img_box)

        body_contents.extend([
            {"type": "text", "text": d["name"], "weight": "bold", "size": "lg", "color": "#0F172A"},
            {"type": "text", "text": f"รหัส: {d['code']} • หมวด: {d['category']}", "size": "xs", "color": "#64748B", "margin": "xs"},
            {"type": "separator", "margin": "md"},
            {
                "type": "box",
                "layout": "vertical",
                "margin": "md",
                "spacing": "sm",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {"type": "text", "text": "คงเหลือ:", "size": "sm", "color": "#64748B"},
                            {"type": "text", "text": f"{d['stock_qty']} {d['unit']}", "weight": "bold", "size": "md", "color": "#EF4444" if is_low else "#0F766E", "align": "end"}
                        ]
                    },
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {"type": "text", "text": "รูปแบบ:", "size": "xs", "color": "#64748B"},
                            {"type": "text", "text": d.get("dosage_form", "-"), "size": "xs", "align": "end"}
                        ]
                    },
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {"type": "text", "text": "วันหมดอายุ:", "size": "xs", "color": "#64748B"},
                            {"type": "text", "text": d.get("expiry_date", "-"), "size": "xs", "align": "end"}
                        ]
                    }
                ]
            }
        ])

        return {
            "type": "flex",
            "altText": f"ข้อมูลยา {d['name']}",
            "contents": {
                "type": "bubble",
                "body": {
                    "type": "box",
                    "layout": "vertical",
                    "contents": body_contents
                },
                "footer": {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        {"type": "button", "action": {"type": "message", "label": f"ตัดสต็อก 1 {d['unit']}", "text": f"{d['name']} 1"}, "style": "primary", "color": "#0F766E"}
                    ]
                }
            }
        }

    def _create_expiry_alert_flex(self, expiring_drugs, days=60):
        """High-fidelity signature Flex Message matching OrgChat social/announcement card style."""
        total = len(expiring_drugs)
        items_to_show = expiring_drugs[:6]
        has_expired = any(d.get("is_expired") for d in expiring_drugs)

        # Soft red / Rose tone (แดงอ่อนๆ สไตล์ที่ผู้ใช้เลือก)
        primary_color = "#E05263" if not has_expired else "#DC2626"
        header_title = "ตรวจพบยาหมดอายุ" if has_expired else "เตือนยาใกล้หมดอายุ"
        header_sub = f"ระบบคลังยา · เกณฑ์ล่วงหน้า {days} วัน"

        body_contents = []

        # Drug item cards
        for d in items_to_show:
            is_expired = d.get("is_expired", False)
            days_left = d.get("days_left", 0)

            if is_expired:
                badge_bg = "#FEF2F2"
                badge_color = "#DC2626"
                badge_text = f"หมดอายุแล้ว ({abs(days_left)} วัน)"
            elif days_left <= 30:
                badge_bg = "#FFF1F2"
                badge_color = "#E11D48"
                badge_text = f"อีก {days_left} วัน"
            else:
                badge_bg = "#FEF3C7"
                badge_color = "#D97706"
                badge_text = f"อีก {days_left} วัน"

            drug_card = {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#F8FAFC",
                "cornerRadius": "10px",
                "paddingAll": "12px",
                "borderColor": "#E2E8F0",
                "borderWidth": "1px",
                "contents": [
                    # Line 1: Drug Name
                    {
                        "type": "text",
                        "text": d.get("name", "ยา"),
                        "weight": "bold",
                        "size": "sm",
                        "color": "#0F172A",
                        "wrap": True
                    },
                    # Line 2: Subtitle
                    {
                        "type": "text",
                        "text": f"{d.get('code', '-')} · {d.get('category', 'ทั่วไป')}",
                        "size": "xxs",
                        "color": "#94A3B8",
                        "margin": "xs",
                        "wrap": True
                    },
                    # Line 3: Expiry Date + Badge on same row
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "margin": "sm",
                        "contents": [
                            {
                                "type": "box",
                                "layout": "baseline",
                                "contents": [
                                    {"type": "text", "text": "วันหมดอายุ", "size": "xs", "color": "#64748B", "flex": 4},
                                    {"type": "text", "text": str(d.get("expiry_date", "-")), "size": "xs", "color": "#0F172A", "weight": "bold", "flex": 6}
                                ],
                                "flex": 7
                            },
                            {
                                "type": "box",
                                "layout": "vertical",
                                "backgroundColor": badge_bg,
                                "cornerRadius": "6px",
                                "paddingStart": "8px",
                                "paddingEnd": "8px",
                                "paddingTop": "2px",
                                "paddingBottom": "2px",
                                "contents": [
                                    {
                                        "type": "text",
                                        "text": badge_text,
                                        "size": "xxs",
                                        "weight": "bold",
                                        "color": badge_color,
                                        "align": "center"
                                    }
                                ],
                                "flex": 4
                            }
                        ],
                        "alignItems": "center"
                    },
                    # Line 4: Stock Location
                    {
                        "type": "box",
                        "layout": "baseline",
                        "margin": "xs",
                        "contents": [
                            {"type": "text", "text": "คงเหลือในคลัง", "size": "xs", "color": "#64748B", "flex": 4},
                            {"type": "text", "text": f"{d.get('stock_qty')} {d.get('unit')} (จัดเก็บ: {d.get('location', '-')})", "size": "xs", "color": "#334155", "flex": 8}
                        ]
                    }
                ]
            }
            body_contents.append(drug_card)

        if total > 6:
            body_contents.append({
                "type": "text",
                "text": f"และอีก {total - 6} รายการในระบบคลัง",
                "size": "xxs",
                "color": "#94A3B8",
                "align": "center",
                "margin": "sm"
            })

        # System info attribution at bottom of body (OrgChat Signature)
        body_contents.append({"type": "separator", "margin": "lg", "color": "#F3F4F6"})
        body_contents.append({
            "type": "box",
            "layout": "horizontal",
            "contents": [
                {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        {"type": "text", "text": "Rx", "color": "#ffffff", "size": "xs", "align": "center", "weight": "bold"}
                    ],
                    "width": "28px",
                    "height": "28px",
                    "backgroundColor": primary_color,
                    "cornerRadius": "14px",
                    "justifyContent": "center",
                    "alignItems": "center"
                },
                {
                    "type": "box",
                    "layout": "vertical",
                    "contents": [
                        {"type": "text", "text": "PharmaCore Inventory", "size": "xs", "color": "#111827", "weight": "bold"},
                        {"type": "text", "text": f"พบยาที่ต้องติดตาม {total} รายการ", "size": "xxs", "color": "#9CA3AF"}
                    ],
                    "paddingStart": "10px"
                }
            ],
            "alignItems": "center",
            "margin": "lg"
        })

        flex_contents = {
            "type": "bubble",
            "size": "mega",
            "header": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": primary_color,
                "paddingAll": "16px",
                "contents": [
                    {
                        "type": "box",
                        "layout": "horizontal",
                        "contents": [
                            {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    {"type": "text", "text": "💊", "size": "xl", "align": "center"}
                                ],
                                "width": "42px",
                                "height": "42px",
                                "backgroundColor": "#ffffff20",
                                "cornerRadius": "12px",
                                "justifyContent": "center",
                                "alignItems": "center"
                            },
                            {
                                "type": "box",
                                "layout": "vertical",
                                "contents": [
                                    {"type": "text", "text": header_title, "color": "#ffffff", "size": "md", "weight": "bold", "wrap": True},
                                    {"type": "text", "text": header_sub, "color": "#ffffff90", "size": "xxs"}
                                ],
                                "paddingStart": "12px"
                            }
                        ],
                        "alignItems": "center"
                    }
                ]
            },
            "body": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#FFFFFF",
                "paddingAll": "18px",
                "spacing": "sm",
                "contents": body_contents
            },
            "footer": {
                "type": "box",
                "layout": "vertical",
                "backgroundColor": "#F9FAFB",
                "paddingAll": "14px",
                "contents": [
                    {
                        "type": "button",
                        "action": {
                            "type": "uri",
                            "label": "เปิดจัดการคลังยาบนเว็บ",
                            "uri": Config.BASE_URL
                        },
                        "style": "primary",
                        "color": primary_color,
                        "height": "sm"
                    }
                ]
            }
        }

        return {
            "type": "flex",
            "altText": f"⏰ แจ้งเตือน: พบยาใกล้หมดอายุ {total} รายการ (เกณฑ์ {days} วัน)",
            "contents": flex_contents
        }

    def send_expiring_drugs_alert(self, days=None, target_id=None, force=False):
        """
        Check for drugs expiring within days and send rich Flex notification to LINE.
        """
        check_days = days if days is not None else Config.EXPIRY_ALERT_DAYS
        expiring = database.get_expiring_drugs(days=check_days)

        if not expiring:
            logger.info(f"No drugs expiring within {check_days} days.")
            return {
                "ok": True,
                "sent": False,
                "count": 0,
                "message": f"ไม่พบรายการยาที่ใกล้หมดอายุภายใน {check_days} วัน"
            }

        from datetime import datetime
        from zoneinfo import ZoneInfo
        bangkok_tz = ZoneInfo("Asia/Bangkok")
        today_str = datetime.now(bangkok_tz).strftime("%Y-%m-%d")
        last_sent = database.get_app_setting("last_expiry_alert_sent")

        if not force and last_sent == today_str:
            logger.info("Expiry alert already sent today. Skipping.")
            return {
                "ok": True,
                "sent": False,
                "count": len(expiring),
                "message": f"ส่งแจ้งเตือนของวันนี้ไปแล้วเมื่อ {last_sent} (ใช้ force=True เพื่อส่งซ้ำ)"
            }

        flex = self._create_expiry_alert_flex(expiring, days=check_days)

        # Collect targets
        targets = []
        if target_id and str(target_id).strip():
            targets = [str(target_id).strip()]
        else:
            config_target = Config.PHARMACY_LINE_TARGET_ID or database.get_app_setting("line_notify_target")
            if config_target and config_target.strip():
                targets = [config_target.strip()]
            else:
                subscribers = database.get_line_subscribers()
                if subscribers:
                    targets = [s["target_id"] for s in subscribers if s.get("target_id")]

        sent_count = 0
        delivery_method = "push"

        if targets:
            for t in targets:
                ok, msg = self.push_message(t, flex)
                if ok:
                    sent_count += 1
                else:
                    logger.warning(f"Failed to push expiry alert to {t}: {msg}")
        else:
            delivery_method = "broadcast"
            ok, msg = self.broadcast_message(flex)
            if ok:
                sent_count = 1
            else:
                logger.error(f"Failed to broadcast expiry alert: {msg}")
                return {"ok": False, "error": f"Broadcast failed: {msg}"}

        database.set_app_setting("last_expiry_alert_sent", today_str)

        return {
            "ok": True,
            "sent": True,
            "expiring_count": len(expiring),
            "delivered_targets": sent_count,
            "method": delivery_method,
            "message": f"ส่งแจ้งเตือนยาใกล้หมดอายุ {len(expiring)} รายการ เข้า LINE สำเร็จ ({delivery_method})"
        }

    def _broadcast_or_push(self, flex, exclude_target=None):
        """
        Helper method to push notification to subscribers or broadcast.
        """
        targets = set()
        config_target = Config.PHARMACY_LINE_TARGET_ID or database.get_app_setting("line_notify_target")
        if config_target and str(config_target).strip():
            targets.add(str(config_target).strip())

        try:
            subscribers = database.get_line_subscribers()
            for s in subscribers:
                tid = s.get("target_id")
                if tid and str(tid).strip() and str(tid).strip() != "unknown":
                    targets.add(str(tid).strip())
        except Exception as e:
            logger.warning(f"Error fetching subscribers for notification: {e}")

        if exclude_target:
            targets.discard(str(exclude_target).strip())

        sent_count = 0
        delivery_method = "push"

        if targets:
            for t in targets:
                ok, msg = self.push_message(t, flex)
                if ok:
                    sent_count += 1
                else:
                    logger.warning(f"Failed to push alert to {t}: {msg}")
        else:
            delivery_method = "broadcast"
            ok, msg = self.broadcast_message(flex)
            if ok:
                sent_count = 1
            else:
                logger.error(f"Failed to broadcast alert: {msg}")
                return {"ok": False, "error": f"Broadcast failed: {msg}"}

        return {
            "ok": True,
            "sent": True,
            "delivered_targets": sent_count,
            "method": delivery_method
        }

    def send_dispense_notification(self, data, exclude_target=None):
        """
        Send stock movement notification to all members / subscribers.
        """
        flex = self._create_dispense_alert_flex(data)
        return self._broadcast_or_push(flex, exclude_target=exclude_target)

    def send_stock_in_notification(self, data, exclude_target=None):
        """
        Send stock in / receiving notification to all members / subscribers.
        """
        flex = self._create_stock_in_alert_flex(data)
        return self._broadcast_or_push(flex, exclude_target=exclude_target)

    def send_new_drug_notification(self, drug, exclude_target=None):
        """
        Send new drug registration notification to all members / subscribers.
        """
        flex = self._create_new_drug_alert_flex(drug)
        return self._broadcast_or_push(flex, exclude_target=exclude_target)

    def send_scan_notification(self, drug, scanned_code=None, source="SCANNER"):
        """
        Scan alert card completely disabled per user request: 'ไม่ต้องมีการ์ดสแกนพบรายการยา'
        """
        logger.info("Scan notification card completely disabled per user preference.")
        return {"ok": True, "sent": False, "skipped": True, "reason": "disabled_by_user"}

line_bot = PharmacyLineBot()
