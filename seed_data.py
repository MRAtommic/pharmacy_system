"""
Seed Initial Realistic Pharmacy Inventory Data
Populates clinical medicines, dosages, units, and barcode IDs.
"""

import sys
sys.stdout.reconfigure(encoding='utf-8')
import database

SAMPLE_DRUGS = [
    {
        "code": "MED-0001",
        "name": "Paracetamol 500 mg",
        "generic_name": "Paracetamol",
        "category": "ยาลดไข้ บรรเทาปวด",
        "dosage_form": "เม็ด (Tablet)",
        "strength": "500 mg",
        "stock_qty": 500,
        "unit": "เม็ด",
        "min_threshold": 50,
        "price": 2.0,
        "cost": 0.8,
        "expiry_date": "2028-12-31",
        "location": "ตู้ A - ชั้น 1",
        "instructions": "รับประทานครั้งละ 1-2 เม็ด ทุก 4-6 ชั่วโมง เมื่อมีอาการปวดหรือมีไข้"
    },
    {
        "code": "MED-0002",
        "name": "Amoxicillin 500 mg",
        "generic_name": "Amoxicillin Trihydrate",
        "category": "ยาปฏิชีวนะ (ฆ่าเชื้อ)",
        "dosage_form": "แคปซูล (Capsule)",
        "strength": "500 mg",
        "stock_qty": 180,
        "unit": "แคปซูล",
        "min_threshold": 30,
        "price": 8.0,
        "cost": 3.5,
        "expiry_date": "2027-08-15",
        "location": "ตู้ A - ชั้น 2",
        "instructions": "รับประทานครั้งละ 1 แคปซูล วันละ 3 ครั้ง ก่อนหรือหลังอาหาร ติดต่อกันจนหมด"
    },
    {
        "code": "MED-0003",
        "name": "Ibuprofen 400 mg",
        "generic_name": "Ibuprofen",
        "category": "ยาลดไข้ บรรเทาปวด",
        "dosage_form": "เม็ดเคลือบฟิล์ม",
        "strength": "400 mg",
        "stock_qty": 120,
        "unit": "เม็ด",
        "min_threshold": 25,
        "price": 5.0,
        "cost": 2.0,
        "expiry_date": "2027-11-20",
        "location": "ตู้ A - ชั้น 1",
        "instructions": "รับประทานครั้งละ 1 เม็ด หลังอาหารทันที ดื่มน้ำตามมากๆ"
    },
    {
        "code": "MED-0004",
        "name": "Omeprazole 20 mg",
        "generic_name": "Omeprazole",
        "category": "ยาระบบทางเดินอาหาร",
        "dosage_form": "แคปซูล (Capsule)",
        "strength": "20 mg",
        "stock_qty": 90,
        "unit": "แคปซูล",
        "min_threshold": 20,
        "price": 10.0,
        "cost": 4.0,
        "expiry_date": "2028-04-10",
        "location": "ตู้ B - ชั้น 1",
        "instructions": "รับประทานครั้งละ 1 แคปซูล ก่อนอาหารเช้า 30 นาที วันละ 1 ครั้ง"
    },
    {
        "code": "MED-0005",
        "name": "Cetirizine 10 mg",
        "generic_name": "Cetirizine Dihydrochloride",
        "category": "ยาแก้แพ้ ลดน้ำมูก",
        "dosage_form": "เม็ด (Tablet)",
        "strength": "10 mg",
        "stock_qty": 240,
        "unit": "เม็ด",
        "min_threshold": 40,
        "price": 4.0,
        "cost": 1.5,
        "expiry_date": "2028-09-30",
        "location": "ตู้ B - ชั้น 2",
        "instructions": "รับประทานครั้งละ 1 เม็ด วันละ 1 ครั้ง ก่อนนอน"
    },
    {
        "code": "MED-0006",
        "name": "NAC Long 600 mg (เม็ดฟู่ละลายเสมหะ)",
        "generic_name": "Acetylcysteine",
        "category": "ยาแก้ไอ ละลายเสมหะ",
        "dosage_form": "เม็ดฟู่ (Effervescent)",
        "strength": "600 mg",
        "stock_qty": 45,
        "unit": "เม็ด",
        "min_threshold": 15,
        "price": 18.0,
        "cost": 11.0,
        "expiry_date": "2027-06-30",
        "location": "ตู้ B - ชั้น 3",
        "instructions": "ละลายน้ำ 1 แก้ว ดื่มวันละ 1 ครั้ง หลังอาหาร"
    },
    {
        "code": "MED-0007",
        "name": "ยาลดกรด Antacid Suspension 240 ml",
        "generic_name": "Aluminium & Magnesium Hydroxide",
        "category": "ยาระบบทางเดินอาหาร",
        "dosage_form": "ยาน้ำแขวนตะกอน (Suspension)",
        "strength": "240 ml",
        "stock_qty": 35,
        "unit": "ขวด",
        "min_threshold": 10,
        "price": 65.0,
        "cost": 42.0,
        "expiry_date": "2027-10-15",
        "location": "ชั้นวางยาน้ำ C",
        "instructions": "เขย่าขวดก่อนใช้ รับประทานครั้งละ 1-2 ช้อนโต๊ะ หลังอาหาร 1 ชั่วโมงและก่อนนอน"
    },
    {
        "code": "MED-0008",
        "name": "Vitamin C 1000 mg",
        "generic_name": "Ascorbic Acid",
        "category": "วิตามินและอาหารเสริม",
        "dosage_form": "เม็ด (Tablet)",
        "strength": "1000 mg",
        "stock_qty": 15,  # Low stock for demonstration!
        "unit": "เม็ด",
        "min_threshold": 20,
        "price": 7.0,
        "cost": 3.0,
        "expiry_date": "2027-05-01",
        "location": "ตู้ C - ชั้น 1",
        "instructions": "รับประทานวันละ 1 เม็ด หลังอาหารเช้า"
    },
    {
        "code": "MED-0009",
        "name": "Augmentin 1 g (Amoxicillin/Clavulanate)",
        "generic_name": "Amoxicillin + Clavulanic Acid",
        "category": "ยาปฏิชีวนะ (ฆ่าเชื้อ)",
        "dosage_form": "เม็ดเคลือบฟิล์ม",
        "strength": "1000 mg",
        "stock_qty": 8,  # Critical low stock!
        "unit": "เม็ด",
        "min_threshold": 15,
        "price": 35.0,
        "cost": 22.0,
        "expiry_date": "2026-11-30",
        "location": "ตู้ A - ชั้น 2",
        "instructions": "รับประทานครั้งละ 1 เม็ด วันละ 2 ครั้ง เช้า-เย็น พร้อมอาหาร"
    },
    {
        "code": "MED-0010",
        "name": "Normal Saline 0.9% 500 ml (น้ำเกลือล้างแผล)",
        "generic_name": "Sodium Chloride 0.9%",
        "category": "เวชภัณฑ์และอุปกรณ์",
        "dosage_form": "ยาน้ำภายนอก",
        "strength": "500 ml",
        "stock_qty": 50,
        "unit": "ขวด",
        "min_threshold": 15,
        "price": 55.0,
        "cost": 32.0,
        "expiry_date": "2029-01-01",
        "location": "ชั้นวางเวชภัณฑ์ D",
        "instructions": "ใช้ล้างแผล ล้างจมูก หรือทำความสะอาดภายนอก"
    }
]

def seed():
    existing = database.get_all_drugs()
    if not existing:
        print("🌱 Seeding realistic pharmacy inventory...")
        for d in SAMPLE_DRUGS:
            database.add_drug(d)
        print(f"✅ Seeded {len(SAMPLE_DRUGS)} drugs successfully.")
    else:
        print(f"Inventory already contains {len(existing)} drugs.")

if __name__ == "__main__":
    seed()
