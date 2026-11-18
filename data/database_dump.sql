BEGIN TRANSACTION;
CREATE TABLE audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_email TEXT NOT NULL,
                user_name TEXT DEFAULT '',
                action TEXT NOT NULL,
                target_type TEXT DEFAULT '',
                target_id TEXT DEFAULT '',
                target_name TEXT DEFAULT '',
                detail TEXT DEFAULT '',
                ip_address TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );
INSERT INTO "audit_logs" VALUES(1,'warapornseehanach@gmail.com','waraporn seehanach','LOGIN','auth','100528804137992288679','warapornseehanach@gmail.com','เข้าสู่ระบบผ่าน Google สำเร็จ | IP: 1.4.134.222','1.4.134.222','2026-10-17 14:26:40');
INSERT INTO "audit_logs" VALUES(2,'warapornseehanach@gmail.com','waraporn seehanach','ADD_DRUG','drug','1','Paracetamol 500','รหัส: MED-001 | หมวด: ยาลดไข้ บรรเทาปวด | สต็อก: 5 กล่อง','1.4.134.222','2026-10-17 14:40:45');
INSERT INTO "audit_logs" VALUES(3,'aabb78231@gmail.com','Supihsara Tanai','LOGIN','auth','112028042209337963580','aabb78231@gmail.com','เข้าสู่ระบบผ่าน Google สำเร็จ | IP: 1.4.134.222','1.4.134.222','2026-10-17 14:45:08');
INSERT INTO "audit_logs" VALUES(4,'aabb78231@gmail.com','Supihsara Tanai','LOGOUT','','','','ออกจากระบบเรียบร้อย','1.4.134.222','2026-10-17 14:50:10');
INSERT INTO "audit_logs" VALUES(5,'aabb78231@gmail.com','Supihsara Tanai','LOGIN','auth','112028042209337963580','aabb78231@gmail.com','เข้าสู่ระบบผ่าน Google สำเร็จ | IP: 1.4.134.222','1.4.134.222','2026-10-17 14:53:22');
INSERT INTO "audit_logs" VALUES(6,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','1','Paracetamol 500','แก้ไขข้อมูลยา | สต็อก: 5 กล่อง','1.4.134.222','2026-10-17 14:55:55');
INSERT INTO "audit_logs" VALUES(7,'warapornseehanach@gmail.com','waraporn seehanach','STOCK_IN','drug','1','Paracetamol 500','รับเข้า 1 กล่อง | Lot:  | Supplier: บริษัท','1.4.134.222','2026-10-17 14:58:58');
INSERT INTO "audit_logs" VALUES(8,'warapornseehanach@gmail.com','waraporn seehanach','VOID_STOCK_IN','stock_in_log','1','Paracetamol 500','ยกเลิกรายการรับเข้า คืนสต็อกลดลง 1 หน่วย | Lot  | คงเหลือใหม่: 5 | เหตุผล: ยกเลิกรายการรับเข้าโดยเจ้าหน้าที่','1.4.134.222','2026-10-17 14:59:27');
INSERT INTO "audit_logs" VALUES(9,'warapornseehanach@gmail.com','waraporn seehanach','DISPENSE','drug','1','Paracetamol 500','ตัดจ่าย 1 กล่อง | คงเหลือ: 4 | ผู้รับ:','1.4.134.222','2026-10-17 15:00:04');
INSERT INTO "audit_logs" VALUES(10,'warapornseehanach@gmail.com','waraporn seehanach','STOCK_IN','drug','1','Paracetamol 500','รับเข้า 2 กล่อง | Lot:  | Supplier: บริษัท','1.4.134.222','2026-10-17 15:00:53');
INSERT INTO "audit_logs" VALUES(11,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','1','Paracetamol 500','แก้ไขข้อมูลยา | สต็อก: 6 กล่อง','1.4.134.222','2026-10-17 15:02:25');
INSERT INTO "audit_logs" VALUES(12,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','1','Paracetamol 500','แก้ไขข้อมูลยา | สต็อก: 6 กล่อง','1.4.134.222','2026-10-17 15:02:54');
INSERT INTO "audit_logs" VALUES(13,'anonymous','','ADD_CATEGORY','category','20','หมวดทดสอบระบบ','เพิ่มหมวดหมู่ยา: หมวดทดสอบระบบ','127.0.0.1','2026-10-17 15:03:49');
INSERT INTO "audit_logs" VALUES(14,'anonymous','','UPDATE_CATEGORY','category','20','หมวดทดสอบระบบ_แก้ไข','แก้ไขหมวดหมู่ยา: หมวดทดสอบระบบ_แก้ไข','127.0.0.1','2026-10-17 15:03:49');
INSERT INTO "audit_logs" VALUES(15,'anonymous','','DELETE_CATEGORY','category','20','20','ลบหมวดหมู่ยา (ย้ายยาไป ทั่วไป)','127.0.0.1','2026-10-17 15:03:49');
INSERT INTO "audit_logs" VALUES(16,'warapornseehanach@gmail.com','waraporn seehanach','VOID_STOCK_IN','stock_in_log','2','Paracetamol 500','ยกเลิกรายการรับเข้า คืนสต็อกลดลง 2 หน่วย | Lot  | คงเหลือใหม่: 4 | เหตุผล: ยกเลิกรายการรับเข้าโดยเจ้าหน้าที่','1.4.134.222','2026-10-17 15:06:39');
INSERT INTO "audit_logs" VALUES(17,'warapornseehanach@gmail.com','waraporn seehanach','VOID_DISPENSE','dispense_log','1','Paracetamol 500','ยกเลิกการจ่าย คืนยา 1 หน่วย | คงเหลือใหม่: 5 | เหตุผล: ยกเลิกรายการจ่ายยาโดยเจ้าหน้าที่','1.4.134.222','2026-10-17 15:06:43');
INSERT INTO "audit_logs" VALUES(18,'mxmm2547@gmail.com','FU TRUE','ADD_CATEGORY','category','21','123','เพิ่มหมวดหมู่ยา: 123','101.109.185.101','2026-10-17 15:11:38');
INSERT INTO "audit_logs" VALUES(19,'mxmm2547@gmail.com','FU TRUE','DELETE_CATEGORY','category','21','21','ลบหมวดหมู่ยา (ย้ายยาไป ทั่วไป)','101.109.185.101','2026-10-17 15:11:59');
INSERT INTO "audit_logs" VALUES(20,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','1','Paracetamol 500','แก้ไขข้อมูลยา | สต็อก: 5 กล่อง','1.4.134.222','2026-10-17 15:55:14');
INSERT INTO "audit_logs" VALUES(21,'admin@pharmacore.clinic','ผู้ดูแลระบบคลังยา (Admin)','LOGIN','AUTH','passcode','Admin','เข้าสู่ระบบด้วย Passcode','127.0.0.1','2026-10-17 16:03:04');
INSERT INTO "audit_logs" VALUES(22,'warapornseehanach@gmail.com','waraporn seehanach','STOCK_IN','drug','1','Paracetamol 500','รับเข้า 2 กล่อง | Lot: LOT-240801 | Supplier: บริษัท','1.4.134.222','2026-10-17 16:19:52');
INSERT INTO "audit_logs" VALUES(23,'aabb78231@gmail.com','Supihsara Tanai','LOGIN','auth','112028042209337963580','aabb78231@gmail.com','เข้าสู่ระบบผ่าน Google สำเร็จ | IP: 1.4.134.222','1.4.134.222','2026-10-17 16:21:09');
INSERT INTO "audit_logs" VALUES(24,'aabb78231@gmail.com','Supihsara Tanai','LOGIN','auth','112028042209337963580','aabb78231@gmail.com','เข้าสู่ระบบผ่าน Google สำเร็จ | IP: 1.4.134.222','1.4.134.222','2026-10-17 16:22:11');
INSERT INTO "audit_logs" VALUES(25,'aabb78231@gmail.com','Supihsara Tanai','LOGOUT','','','','ออกจากระบบเรียบร้อย','1.4.134.222','2026-10-17 16:23:13');
INSERT INTO "audit_logs" VALUES(26,'aabb78231@gmail.com','Supihsara Tanai','LOGIN','auth','112028042209337963580','aabb78231@gmail.com','เข้าสู่ระบบผ่าน Google สำเร็จ | IP: 1.4.134.222','1.4.134.222','2026-10-17 16:23:26');
INSERT INTO "audit_logs" VALUES(27,'warapornseehanach@gmail.com','waraporn seehanach','VOID_STOCK_IN','stock_in_log','4','Paracetamol 500','ยกเลิกรายการรับเข้า คืนสต็อกลดลง 2 หน่วย | Lot LOT-240801 | คงเหลือใหม่: 5 | เหตุผล: ยกเลิกรายการรับเข้าโดยเจ้าหน้าที่','1.4.134.222','2026-10-17 16:27:48');
INSERT INTO "audit_logs" VALUES(28,'chaichana.toomjan@gmail.com','Chaichana Toomjan','LOGIN','auth','112141852174125725584','chaichana.toomjan@gmail.com','เข้าสู่ระบบผ่าน Google สำเร็จ | IP: 125.26.48.24','125.26.48.24','2026-10-17 17:04:18');
INSERT INTO "audit_logs" VALUES(29,'mxmm2547@gmail.com','FU TRUE','EDIT_DRUG','drug','1','Paracetamol 500','แก้ไขข้อมูลยา | สต็อก: 5 กล่อง','2a09:bac5:56bc:25d7::3c5:2','2026-10-17 17:27:46');
INSERT INTO "audit_logs" VALUES(30,'warapornseehanach@gmail.com','waraporn seehanach','LOGOUT','','','','ออกจากระบบเรียบร้อย','1.10.163.135','2026-10-21 15:54:42');
INSERT INTO "audit_logs" VALUES(31,'warapornseehanach@gmail.com','waraporn seehanach','LOGIN','auth','100528804137992288679','warapornseehanach@gmail.com','เข้าสู่ระบบผ่าน Google สำเร็จ | IP: 1.10.163.135','1.10.163.135','2026-10-21 15:54:52');
INSERT INTO "audit_logs" VALUES(32,'warapornseehanach@gmail.com','waraporn seehanach','LOGIN','auth','100528804137992288679','warapornseehanach@gmail.com','เข้าสู่ระบบผ่าน Google สำเร็จ | IP: 1.10.163.135','1.10.163.135','2026-10-21 15:55:17');
INSERT INTO "audit_logs" VALUES(33,'warapornseehanach@gmail.com','waraporn seehanach','DISPENSE','drug','1','Paracetamol 500','ตัดจ่าย 1 กล่อง | คงเหลือ: 4 | ผู้รับ: กรรณิกา','1.10.163.135','2026-10-21 16:08:32');
INSERT INTO "audit_logs" VALUES(34,'warapornseehanach@gmail.com','waraporn seehanach','DISPENSE','drug','1','Paracetamol 500','ตัดจ่าย 1 กล่อง | คงเหลือ: 3 | ผู้รับ: วราภรณ์','1.10.163.135','2026-10-21 16:12:24');
INSERT INTO "audit_logs" VALUES(35,'warapornseehanach@gmail.com','waraporn seehanach','ADD_DRUG','drug','2','Albendazole 400mg/20ml suspension','รหัส: MED-002 | หมวด: ทั่วไป | สต็อก: 20 ขวด','1.10.173.44','2026-10-22 11:45:50');
INSERT INTO "audit_logs" VALUES(36,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','2','Albendazole 400mg/20ml suspension','แก้ไขข้อมูลยา | สต็อก: 20 ขวด','1.10.173.44','2026-10-22 11:49:41');
INSERT INTO "audit_logs" VALUES(37,'warapornseehanach@gmail.com','waraporn seehanach','ADD_DRUG','drug','3','ammoncarb syr.','รหัส: MED-003 | หมวด: ยาแก้ไอ ละลายเสมหะ | สต็อก: 150 ขวด','1.10.173.44','2026-10-22 11:56:06');
INSERT INTO "audit_logs" VALUES(38,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','3','ammoncarb syr.','แก้ไขข้อมูลยา | สต็อก: 150 ขวด','1.10.173.44','2026-10-22 11:57:47');
INSERT INTO "audit_logs" VALUES(39,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','3','ammoncarb syr.','แก้ไขข้อมูลยา | สต็อก: 200 ขวด','1.10.173.44','2026-10-22 12:01:29');
INSERT INTO "audit_logs" VALUES(40,'warapornseehanach@gmail.com','waraporn seehanach','STOCK_IN','drug','3','ammoncarb syr.','รับเข้า 1 ขวด | Lot: LOT-240801 | Supplier: บริษัท','1.10.173.44','2026-10-22 14:24:26');
INSERT INTO "audit_logs" VALUES(41,'warapornseehanach@gmail.com','waraporn seehanach','VOID_STOCK_IN','stock_in_log','8','ammoncarb syr.','ยกเลิกรายการรับเข้า คืนสต็อกลดลง 1 หน่วย | Lot LOT-240801 | คงเหลือใหม่: 200 | เหตุผล: ยกเลิกรายการรับเข้าโดยเจ้าหน้าที่','1.10.173.44','2026-10-22 14:25:00');
INSERT INTO "audit_logs" VALUES(42,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','3','ammoncarb syr.','แก้ไขข้อมูลยา | สต็อก: 200 ขวด','1.10.173.44','2026-10-22 14:27:29');
INSERT INTO "audit_logs" VALUES(43,'warapornseehanach@gmail.com','waraporn seehanach','STOCK_IN','drug','3','ammoncarb syr.','รับเข้า 200 ขวด | Lot: M680135 | Supplier: องค์การเภสัชกรรม (GPO)','1.10.173.44','2026-10-22 14:28:31');
INSERT INTO "audit_logs" VALUES(44,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','3','ammoncarb syr.','แก้ไขข้อมูลยา | สต็อก: 200 ขวด','1.10.173.44','2026-10-22 14:29:35');
INSERT INTO "audit_logs" VALUES(45,'admin@pharmacore.clinic','ผู้ดูแลระบบคลังยา (Admin)','LOGIN','AUTH','passcode','Admin','เข้าสู่ระบบด้วย Passcode','127.0.0.1','2026-10-22 14:34:17');
INSERT INTO "audit_logs" VALUES(46,'warapornseehanach@gmail.com','waraporn seehanach','ADD_DRUG','drug','4','Albendazole 200 mg tab','รหัส: MED-004 | หมวด: ทั่วไป | สต็อก: 0 เม็ด','1.10.173.44','2026-10-22 14:34:56');
INSERT INTO "audit_logs" VALUES(47,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','4','Albendazole 200 mg tab','แก้ไขข้อมูลยา | สต็อก: 0 เม็ด','1.10.173.44','2026-10-22 14:37:09');
INSERT INTO "audit_logs" VALUES(48,'admin@pharmacore.clinic','ผู้ดูแลระบบคลังยา (Admin)','LOGIN','AUTH','passcode','Admin','เข้าสู่ระบบด้วย Passcode','127.0.0.1','2026-10-22 14:40:22');
INSERT INTO "audit_logs" VALUES(49,'warapornseehanach@gmail.com','waraporn seehanach','ADD_DRUG','drug','5','Calamine Lotion','รหัส: MED-0005 | หมวด: ทั่วไป | สต็อก: 0 ขวด','1.10.173.44','2026-10-22 15:05:18');
INSERT INTO "audit_logs" VALUES(50,'warapornseehanach@gmail.com','waraporn seehanach','ADD_DRUG','drug','6','CPM 10 mg/ml inj.','รหัส: MED-006 | หมวด: ทั่วไป | สต็อก: 50 Amp','1.10.173.44','2026-10-22 15:10:06');
INSERT INTO "audit_logs" VALUES(51,'warapornseehanach@gmail.com','waraporn seehanach','LOGOUT','','','','ออกจากระบบเรียบร้อย','1.10.173.44','2026-10-22 15:11:14');
INSERT INTO "audit_logs" VALUES(52,'warapornseehanach@gmail.com','waraporn seehanach','LOGIN','auth','100528804137992288679','warapornseehanach@gmail.com','เข้าสู่ระบบผ่าน Google สำเร็จ | IP: 1.10.173.44','1.10.173.44','2026-10-22 15:11:21');
INSERT INTO "audit_logs" VALUES(53,'warapornseehanach@gmail.com','waraporn seehanach','EDIT_DRUG','drug','1','Paracetamol 500','แก้ไขข้อมูลยา | สต็อก: 3 กล่อง','1.4.128.120','2026-11-11 09:49:02');
INSERT INTO "audit_logs" VALUES(54,'warapornseehanach@gmail.com','waraporn seehanach','STOCK_IN','drug','2','Albendazole 400mg/20ml suspension','รับเข้า 2 ขวด | Lot:  | Supplier: องค์การเภสัชกรรม (GPO)','1.10.163.230','2026-11-18 13:13:17');
INSERT INTO "audit_logs" VALUES(55,'warapornseehanach@gmail.com','waraporn seehanach','STOCK_IN','drug','4','Albendazole 200 mg tab','รับเข้า 200 เม็ด | Lot: A690271 | Supplier: องค์การเภสัชกรรม (GPO)','1.10.163.230','2026-11-18 13:17:14');
INSERT INTO "audit_logs" VALUES(56,'warapornseehanach@gmail.com','waraporn seehanach','STOCK_IN','drug','4','Albendazole 200 mg tab','รับเข้า 200 เม็ด | Lot: A690271 | Supplier: องค์การเภสัชกรรม (GPO)','1.10.163.230','2026-11-18 13:23:08');
CREATE TABLE categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                color TEXT DEFAULT 'teal'
            );
INSERT INTO "categories" VALUES(10,'ยาลดไข้ บรรเทาปวด','blue');
INSERT INTO "categories" VALUES(11,'ยาปฏิชีวนะ (ฆ่าเชื้อ)','rose');
INSERT INTO "categories" VALUES(12,'ยาระบบทางเดินอาหาร','amber');
INSERT INTO "categories" VALUES(13,'ยาแก้แพ้ ลดน้ำมูก','cyan');
INSERT INTO "categories" VALUES(14,'ยาแก้ไอ ละลายเสมหะ','teal');
INSERT INTO "categories" VALUES(15,'ยาสมุนไพร','emerald');
INSERT INTO "categories" VALUES(16,'วิตามินและอาหารเสริม','purple');
INSERT INTO "categories" VALUES(17,'เวชภัณฑ์และอุปกรณ์','indigo');
INSERT INTO "categories" VALUES(18,'ทั่วไป','slate');
CREATE TABLE dispensing_logs (
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
                created_at TEXT NOT NULL, is_voided INTEGER DEFAULT 0, void_reason TEXT DEFAULT '', voided_by TEXT DEFAULT '', voided_at TEXT DEFAULT '', batch_id TEXT DEFAULT '', lot_id INTEGER, lot_number TEXT DEFAULT '',
                FOREIGN KEY (drug_id) REFERENCES drugs (id) ON DELETE SET NULL
            );
INSERT INTO "dispensing_logs" VALUES(1,1,'MED-001','Paracetamol 500',1,5,4,'WEB_MANUAL','waraporn seehanach','',NULL,NULL,'',0,'2026-10-17 15:00:04',1,'ยกเลิกรายการจ่ายยาโดยเจ้าหน้าที่','waraporn seehanach (warapornseehanach@gmail.com)','2026-10-17 15:06:43','',NULL,'');
INSERT INTO "dispensing_logs" VALUES(2,1,'MED-001','Paracetamol 500',1,5,4,'QR_SCAN','waraporn seehanach','กรรณิกา',NULL,NULL,'',0,'2026-10-21 16:08:32',0,'','','','',NULL,'');
INSERT INTO "dispensing_logs" VALUES(3,1,'MED-001','Paracetamol 500',1,4,3,'QR_SCAN','waraporn seehanach','วราภรณ์',NULL,NULL,'',0,'2026-10-21 16:12:24',0,'','','','',NULL,'');
CREATE TABLE drug_lots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                drug_id INTEGER NOT NULL,
                lot_number TEXT NOT NULL,
                stock_qty INTEGER NOT NULL DEFAULT 0,
                initial_qty INTEGER NOT NULL DEFAULT 0,
                cost_per_unit REAL DEFAULT 0.0,
                expiry_date TEXT,
                location TEXT DEFAULT '',
                qr_payload TEXT,
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                is_active INTEGER DEFAULT 1,
                FOREIGN KEY (drug_id) REFERENCES drugs (id) ON DELETE CASCADE,
                UNIQUE(drug_id, lot_number)
            );
INSERT INTO "drug_lots" VALUES(1,1,'LOT-240801',3,3,120.0,'2030-08-08','','MED-001#LOT-240801','','2026-10-17 14:40:45','2026-10-22 14:31:03',1);
INSERT INTO "drug_lots" VALUES(2,2,'M670199',20,20,14.5,'2028-06-25','','MED-002#M670199','','2026-10-22 11:45:50','2026-10-22 13:47:22',1);
INSERT INTO "drug_lots" VALUES(7,3,'M680135',200,200,8.5,'2027-04-29','','MED-003#M680135','','2026-10-22 14:28:31','2026-10-22 14:28:31',1);
INSERT INTO "drug_lots" VALUES(8,4,'LOT-261022',0,0,165.0,'','ตู้เก็บยาหลัก','MED-004#LOT-261022','','2026-10-22 14:34:56','2026-10-22 14:34:56',1);
INSERT INTO "drug_lots" VALUES(9,5,'LOT-261022',0,0,15.0,'','ตู้เก็บยาหลัก','MED-0005#LOT-261022','','2026-10-22 15:05:18','2026-10-22 15:05:18',1);
INSERT INTO "drug_lots" VALUES(10,6,'LOT-261022',50,50,2.25,'','ตู้เก็บยาหลัก','MED-006#LOT-261022','','2026-10-22 15:10:06','2026-10-22 15:10:06',1);
INSERT INTO "drug_lots" VALUES(11,2,'LOT-261118',2,2,14.5,'2028-06-25','','MED-002#LOT-261118','','2026-11-18 13:13:17','2026-11-18 13:13:17',1);
INSERT INTO "drug_lots" VALUES(12,4,'A690271',400,400,165.0,'2029-03-04','','MED-004#A690271','','2026-11-18 13:17:14','2026-11-18 13:23:08',1);
CREATE TABLE drugs (
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
                location TEXT DEFAULT 'ตู้เก็บยาหลัก',
                qr_payload TEXT,
                instructions TEXT,
                created_at TEXT,
                updated_at TEXT
            , lot_number TEXT DEFAULT '', image_url TEXT DEFAULT '');
INSERT INTO "drugs" VALUES(1,'MED-001','Paracetamol 500','Paracetamol 500mg','ยาลดไข้ บรรเทาปวด','เม็ด','500 mg',3,'กล่อง',1,120.0,120.0,'2030-08-08','','PHARM:MED-001','','2026-10-17 14:40:45','2026-11-11 09:49:02','LOT-240801','/static/uploads/drugs/drug_846b69af7de2.jpg');
INSERT INTO "drugs" VALUES(2,'MED-002','Albendazole 400mg/20ml suspension','Albendazole 400mg/20ml suspension','ทั่วไป','syrup','400mg /20ml',22,'ขวด',10,14.5,14.5,'2028-06-25','','PHARM:MED-002','','2026-10-22 11:45:50','2026-11-18 13:13:17','M670199','/static/uploads/drugs/drug_f85d5ebe8552.jpg');
INSERT INTO "drugs" VALUES(3,'MED-003','ammoncarb syr.','ammoncarb syr.','ยาแก้ไอ ละลายเสมหะ','syrup','',200,'ขวด',50,8.5,8.5,'2027-04-29','','PHARM:MED-003','','2026-10-22 11:56:06','2026-10-22 14:54:13','M680135','/static/uploads/drugs/drug_8ba4b1033de5.png');
INSERT INTO "drugs" VALUES(4,'MED-004','Albendazole 200 mg tab','Albendazole 200 mg tab','ทั่วไป','เม็ด','200mg',400,'เม็ด',10,165.0,165.0,'2029-03-04','','PHARM:MED-004','','2026-10-22 14:34:56','2026-11-18 13:23:08','A690271','/static/uploads/drugs/drug_7f117a95ec17.jpg');
INSERT INTO "drugs" VALUES(5,'MED-0005','Calamine Lotion','Calamine Lotion','ทั่วไป','ขวด','',0,'ขวด',10,15.0,15.0,'','','PHARM:MED-0005','','2026-10-22 15:05:18','2026-10-22 15:05:18','','/static/uploads/drugs/drug_a5d70ce9a0ee.jpg');
INSERT INTO "drugs" VALUES(6,'MED-006','CPM 10 mg/ml inj.','CPM 10 mg/ml inj.','ทั่วไป','Amp','10mg',50,'Amp',20,2.25,2.25,'','','PHARM:MED-006','','2026-10-22 15:10:06','2026-10-22 15:10:06','','');
CREATE TABLE line_subscribers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_id TEXT UNIQUE NOT NULL,
                target_type TEXT DEFAULT 'user',
                display_name TEXT DEFAULT '',
                is_active INTEGER DEFAULT 1,
                created_at TEXT,
                last_active TEXT
            , is_staff INTEGER DEFAULT 0);
INSERT INTO "line_subscribers" VALUES(1,'Ud59aeb5a098d5ab9640e383b3b710667','user','Waraporn Lin',1,'2026-09-30 19:33:19','2026-10-14 21:21:35',0);
INSERT INTO "line_subscribers" VALUES(2,'U_test_subscriber_12345','user','Test Line User',0,'2026-10-01 19:35:36','2026-10-15 16:27:04',0);
INSERT INTO "line_subscribers" VALUES(31,'Uad137396cc2d041514eff4f828a5e898','user','Few',1,'2026-10-16 17:19:48','2026-10-16 17:21:23',0);
CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT
            );
INSERT INTO "settings" VALUES('pharmacy_spreadsheet_id','','2026-10-15 18:17:04');
INSERT INTO "settings" VALUES('pharmacy_drive_folder_id','','2026-10-15 18:17:04');
INSERT INTO "settings" VALUES('oauth_state_InGKQ1g2Kow9CPgJ2u-X-HM6JLhIstmVk9h_rXRwWGE','https://openchat.sbs/api/auth/google/callback','2026-09-30 13:26:36');
INSERT INTO "settings" VALUES('oauth_state_FNDHAFh3-ka6iruESBaqPbYFepB7j8hTFaXJVuFMA54','https://openchat.sbs/api/auth/google/callback','2026-09-30 13:30:08');
INSERT INTO "settings" VALUES('oauth_state_IYR6z9j_ZM5qBhospqvpwhffkW2mfepqY1r2ls0xXn8','http://127.0.0.1:5005/api/auth/google/callback','2026-09-30 13:32:51');
INSERT INTO "settings" VALUES('oauth_state_zgEC70KsF8S_XysEbvR7fCk8w9gNira2YaUP6oh4g5o','http://127.0.0.1:5005/api/auth/google/callback','2026-09-30 13:33:42');
INSERT INTO "settings" VALUES('oauth_state_CKQv88EDktvAQQbDxr1GQkEnAPhJ--_h6tcmomhaQEY','https://openchat.sbs/api/auth/google/callback','2026-09-30 13:35:01');
INSERT INTO "settings" VALUES('oauth_state_Dz1WOJZRR_PT4X8Z-pQrY_etXD_l9PqfWtACy5feJA8','https://openchat.sbs/api/auth/google/callback','2026-09-30 15:08:55');
INSERT INTO "settings" VALUES('google_oauth_access_token','','2026-10-15 18:17:04');
INSERT INTO "settings" VALUES('google_oauth_refresh_token','','2026-10-15 18:17:04');
INSERT INTO "settings" VALUES('google_oauth_email','','2026-10-15 18:17:04');
INSERT INTO "settings" VALUES('oauth_state_69f_TwkZryk_IN7Vb3lXLZDNvLo2Fp-zafv93IOgJmU','https://openchat.sbs/api/auth/google/callback','2026-09-30 16:50:17');
INSERT INTO "settings" VALUES('last_expiry_alert_sent','2026-10-15','2026-10-15 00:14:47');
INSERT INTO "settings" VALUES('oauth_state_IMs_wb81k6cEn-bVFGiFpswMhyPPOVPVazhsxVrT3Aw','https://openchat.sbs/api/auth/google/callback','2026-09-30 22:32:13');
INSERT INTO "settings" VALUES('login_state_9TnUnylh6Y37uF7OrJ8uLSKZA04X38QLZg_YHrG1uv0','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 19:47:39');
INSERT INTO "settings" VALUES('login_state_O8G_uZTbe0R-zdSfovbMZo6cS8_xJLo96oH0q4Exa1I','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 19:48:08');
INSERT INTO "settings" VALUES('login_state_8-7JBKxi9c3IYYWnAUHvbRfxYcTLU2Vopm0vfZqIXto','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 19:51:46');
INSERT INTO "settings" VALUES('login_state_sq473JaE1C09fLUXxlkDuahgrS6FjUjG2GLrxOzm77Q','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 20:16:57');
INSERT INTO "settings" VALUES('login_state_AtSD8gPDA8P96ZYKgK1FNRDYlUCiKIgAFNJsYRd6yCo','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 20:24:02');
INSERT INTO "settings" VALUES('login_state_HVcMzJCM2_Fb4cH1-NIcHeRLLJoYsZFzr4y09mlS3rM','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 20:50:22');
INSERT INTO "settings" VALUES('login_state_U5LwtsDCBFhHlOKxcsgU9eS4MA836--9JQWrii1JTcE','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 20:53:31');
INSERT INTO "settings" VALUES('login_state_Je4iAYyh_bOMmgwo7DTa15J2myL3JCJJa0irSRBuU74','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 21:06:34');
INSERT INTO "settings" VALUES('login_state_pyVDa1st66maVDjjB4mDw5mCiTup5fMb1KXQrFgvmnU','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 21:08:37');
INSERT INTO "settings" VALUES('login_state_XW89zqli0nw6AKx0VA5L55DuTqt7eSZqawiU7tByI9c','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 21:08:59');
INSERT INTO "settings" VALUES('login_state_88kvRNM1xxTuG6_qQWQKiIhvUZr2PPwcAuk3hXLMHSg','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 21:09:47');
INSERT INTO "settings" VALUES('login_state_FZlO6FZKBZejQie7-BPkIHN1BWqP9pSfZN0XInYoXdk','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 21:57:35');
INSERT INTO "settings" VALUES('login_state_kTdRa1WGbgjmFD7BH7CMNQcihq7eaeyii4CpEgCZn5w','http://localhost:5005/api/auth/google/callback|||/','2026-10-14 22:03:23');
INSERT INTO "settings" VALUES('login_state_sqZrFL4NGNPeGGO1V1nsHFSnqmkIGY4PTdWrANrqdWc','http://localhost:5005/api/auth/google/callback|||/','2026-10-14 22:10:06');
INSERT INTO "settings" VALUES('login_state_OJY2uHh2wQlI8YXd0kRSbFxNGQTzPlawOYSuhoitv8o','http://localhost:5005/api/auth/google/callback|||/','2026-10-14 22:12:08');
INSERT INTO "settings" VALUES('login_state_nMgDeNpbnO1cZmSTA3mlpy4meviMpe5rBE4f2gHuGoc','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 22:12:46');
INSERT INTO "settings" VALUES('login_state_63E5apVLk85sNYEvTyrbERHv8Q_euy5WXEOfdgzfWrM','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 22:42:15');
INSERT INTO "settings" VALUES('login_state_Og-sDHH_KK2981X9v09UPNuoOkYzS32V0BxQd91DS38','https://openchat.sbs/api/auth/google/callback|||/','2026-10-14 23:07:30');
INSERT INTO "settings" VALUES('login_state_eAtex5aGM0MuanZBlahHZrGO5U-fPz2KVP0geUWTEm8','https://openchat.sbs/api/auth/google/callback|||/','2026-10-15 00:07:43');
INSERT INTO "settings" VALUES('login_state_LPbRyB-PEjclIofTJQ0w42rPyHBLNQr3_c7DGBDLDcY','https://openchat.sbs/api/auth/google/callback|||/','2026-10-15 01:12:28');
INSERT INTO "settings" VALUES('login_state_lN8on_lZV7jwQijGq7229jFa4qn7K-IGoxfYEW5SXUE','http://localhost:5005/api/auth/google/callback|||/','2026-10-15 03:16:30');
INSERT INTO "settings" VALUES('login_state_8Nje6hVvpiKJXf08sS28QCljOXdF60irgkevD_XSIc0','http://localhost:5005/api/auth/google/callback|||/','2026-10-15 03:29:02');
INSERT INTO "settings" VALUES('login_state_3YZEIuS0t9CTp2pu7GfKc33pI3yzttvdtkZnaHDqNSs','https://openchat.sbs/api/auth/google/callback|||/','2026-10-15 03:31:55');
INSERT INTO "settings" VALUES('login_state_wBLpn-5FIim8pmDE0Vvppq8wsEda0aKY4sFbEpJN0DA','https://openchat.sbs/api/auth/google/callback|||/','2026-10-15 03:43:26');
INSERT INTO "settings" VALUES('login_state_9_9qW8vMJyH8ssdKzBMODxdSjy-jyrKCn89rgRpi3Qs','https://openchat.sbs/api/auth/google/callback|||/','2026-10-15 16:14:49');
INSERT INTO "settings" VALUES('login_state_WTWIUX7BriKOAdwbQ8-YYDTTOyP2nxa22AOS6KOqeRA','https://openchat.sbs/api/auth/google/callback|||/','2026-10-15 17:27:14');
INSERT INTO "settings" VALUES('login_state_RgkHJJKIxD-vOSsnbqjjs2tYJMVcHyEwIfvzpOcRXGw','https://openchat.sbs/api/auth/google/callback|||/','2026-10-15 17:35:22');
INSERT INTO "settings" VALUES('login_state_Bl0sQgi4v8qFT_R_PoVtMVx-IGsC7Qb5foj94BhVFFU','https://openchat.sbs/api/auth/google/callback|||/','2026-10-15 17:35:52');
INSERT INTO "settings" VALUES('login_state_5-n9Nyd8A6_JzEy0jD8W1yFItgEPAiikPtoubw8nAyE','https://openchat.sbs/api/auth/google/callback|||/','2026-10-15 17:36:52');
INSERT INTO "settings" VALUES('login_state_DXOFoPAnJgbO-_mTgHASglgli4HoWAduV45c6QrfY8U','https://openchat.sbs/api/auth/google/callback|||/','2026-10-15 17:37:23');
INSERT INTO "settings" VALUES('login_state_-EEvh2Nq8UzWNQOdgWaptjonc7RwAs1thlarESmWOGE','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-15 17:42:12');
INSERT INTO "settings" VALUES('login_state_FwzVKx_bolELEj6Tjj36oR6uj2zrz6KTXuheVgDYd6c','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-15 17:44:39');
INSERT INTO "settings" VALUES('login_state__U8bU1t-o0jMyaP3vQKKohAQhido_Jul_KpngAyHlV4','https://beliefs-collectors-macintosh-interim.trycloudflare.com/api/auth/google/callback|||/','2026-10-15 17:47:28');
INSERT INTO "settings" VALUES('login_state_QzpWFLVZqPY-j24YFoArtS6U_44ishVPOiNpOeZGiPw','https://beliefs-collectors-macintosh-interim.trycloudflare.com/api/auth/google/callback|||/','2026-10-15 17:47:38');
INSERT INTO "settings" VALUES('login_state_KVqF5OBwWBixMm33s4fJF2qiaMMvl3VCDYE7oZjRLFc','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-15 17:50:03');
INSERT INTO "settings" VALUES('login_state_1NUFv6ouepTcDXhpWoRQWrFqud7jW92EnNhfuFDAZe8','http://localhost:5005/api/auth/google/callback|||/','2026-10-15 17:50:35');
INSERT INTO "settings" VALUES('login_state_stZSKoBuwewh9JX9Rk0yFLubvM3thlP3fo7XQKpNHO4','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-15 17:50:44');
INSERT INTO "settings" VALUES('login_state_9jJqjowKfD_zDAA0GWSQvl80bMoald8VTCjDxEUj4vU','https://beliefs-collectors-macintosh-interim.trycloudflare.com/api/auth/google/callback|||/','2026-10-15 17:52:03');
INSERT INTO "settings" VALUES('login_state_20hyHjhYGttN99NFTEPMzpciDFNxbpIR1qWRzmQDWzE','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-15 17:53:31');
INSERT INTO "settings" VALUES('login_state_3lft74J9hfgZ3ZdLG2KTmiVO2ts1zKlh0bAgWjXvZLc','https://openchat.sbs/api/auth/google/callback|||/','2026-10-16 14:44:08');
INSERT INTO "settings" VALUES('login_state_b6pmxdsQkfQpkLRjhtCxm4qhFija74KT9cawRIdGjh4','https://openchat.sbs/api/auth/google/callback|||/','2026-10-16 14:46:17');
INSERT INTO "settings" VALUES('login_state_PIFEJ2zZif4Aj1ECwIBUZD26RRypt4n3O_1y7qSJNds','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 14:46:51');
INSERT INTO "settings" VALUES('login_state_e-9kQRK2L46ed7oU8nvXq0eQLTnuVmAtC0uhvj1SMzo','http://localhost:5005/api/auth/google/callback|||/','2026-10-16 14:47:00');
INSERT INTO "settings" VALUES('login_state_utu083YRmEm3oYQPz9nFKsgxLlW0TCfflTRmmICqfgs','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 14:47:01');
INSERT INTO "settings" VALUES('login_state_iQNL-HgvsEcROV0UzUa04ZQ9oZaQ5zlmEuRXAo4Cxrg','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 15:41:40');
INSERT INTO "settings" VALUES('login_state_I-yFXeYt5noyjH2t9J4YWUcs0YmOJYnyG20RXvnLe74','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 15:50:43');
INSERT INTO "settings" VALUES('login_state_nQwLvPyq3Q0axz9Lc9Wts_jxhjbNVOqdjqP44l4IxbA','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 15:52:39');
INSERT INTO "settings" VALUES('login_state_E_dqmBzX0G3eLYXoweweTPN8XCDz9Rx1Ku0MyK0yjMM','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 15:53:37');
INSERT INTO "settings" VALUES('login_state_PCDcX5WuhjUEBaATk0uUhbbpRzdy3XnLE6QBdk7hEns','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 15:55:01');
INSERT INTO "settings" VALUES('login_state_9taAok3-8nioO6brMLuqwU7Iiyb12PpX8XhOz8lXHqg','http://localhost:5005/api/auth/google/callback|||/','2026-10-16 16:02:40');
INSERT INTO "settings" VALUES('login_state_QKzxHY8E4nOIQSTI3yzX26iCM1xHdOzSHo6BATJqza0','http://localhost:5005/api/auth/google/callback|||/','2026-10-16 16:03:09');
INSERT INTO "settings" VALUES('login_state_1Fx0mOtyl6b76knf0kxlu313VzXl_GItWsi3zq4JaIM','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 16:06:30');
INSERT INTO "settings" VALUES('login_state_s71pS3NKC8L7-nr9qToAYAe53ol6HyJ0ZnKUsKddAZw','http://localhost:5005/api/auth/google/callback|||/','2026-10-16 17:40:22');
INSERT INTO "settings" VALUES('login_state_fDq973UgX-wlK_Ppa8cBiZ2YWKYJ4Q5G4JzYYF2BIYs','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 17:47:58');
INSERT INTO "settings" VALUES('login_state_W_7lCLR5uqnAQ7mMh6QxllL8ayDX-IVzGS2j6UAIS2M','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 17:56:56');
INSERT INTO "settings" VALUES('login_state_tJmuvFy1a_Ctx7wnF1vF-qVcGAdmUqfX3pXYN25EnkM','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 17:57:36');
INSERT INTO "settings" VALUES('login_state_OaZOZNHKpQfyBCxFmzfrd276G-vCQ8a67Y980XEtI4o','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 17:59:39');
INSERT INTO "settings" VALUES('login_state_p4kQX4k-SpvGj1DS4AygNTLAxp9xij5pIPqbsnaTBQA','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 18:04:10');
INSERT INTO "settings" VALUES('login_state_LIncm7dnUllgvWwZne0sHpK7lahqmMGO_vucN0wJ8jY','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 18:07:55');
INSERT INTO "settings" VALUES('login_state_SSewXMMCaDhvEZQbWhSfV8NXnrzwzkNPkv4vPFKC_WY','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 18:08:43');
INSERT INTO "settings" VALUES('login_state_A_5aeqzZqWVaIlxkgiT_nDn8VcCiLOFHY-Z3MqHfsRI','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 18:11:40');
INSERT INTO "settings" VALUES('login_state_9gFwifXwc2NbZJLR-o8DKnbmFEsTi-sTAJpx7G1QQfk','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-16 18:13:16');
INSERT INTO "settings" VALUES('login_state_gwyj9t9oYaVPRdTXp_dvUe3963a2k6J299A-0DjOqT8','http://localhost:5005/api/auth/google/callback|||/','2026-10-17 14:25:19');
INSERT INTO "settings" VALUES('login_state_R4Y4PqCfMDfD8IuK5-y2Cc1EguJpCmzlSpYWJ74pyuo','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-17 14:25:35');
INSERT INTO "settings" VALUES('login_state_MJECSqoKSYhrXByd5ghCzwwKhTMf3L_eQyzmYa5AQRk','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-17 14:44:48');
INSERT INTO "settings" VALUES('login_state_Ady-l9-LJlHJYy-srLo65RYpbNe5IKk1N0o9DWw1BmA','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-17 14:53:15');
INSERT INTO "settings" VALUES('login_state_FXC_Fvzqq72AtAxwO1wbBdGEJXaAxV2DxBIfLW7p6q8','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-17 16:20:38');
INSERT INTO "settings" VALUES('login_state_8kaay6grOChI6yOZwc0oOYWyWRnrDCcnrYO__qYxoVQ','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-17 16:22:06');
INSERT INTO "settings" VALUES('login_state_DqfrCd0BJxxk9-aLfAVzgkRrmjr23jYxx6f7OU1h9Ow','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-17 16:23:22');
INSERT INTO "settings" VALUES('login_state_X4YLXcdhCY6b6HdIvVDQa4MyU71W6HLDLjKYnphUPlQ','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-17 17:04:11');
INSERT INTO "settings" VALUES('login_state_6ykiL3FVefyPUjFo7Wu-kP8K_2tGWbGK3CJ6fmBHoRg','http://localhost:5005/api/auth/google/callback|||/','2026-10-21 15:54:03');
INSERT INTO "settings" VALUES('login_state_Lh6bjuCoGngcsxMlQ9Oy38jWxFNIB6NuSxXNbvtWyJ4','http://localhost:5005/api/auth/google/callback|||/','2026-10-21 15:54:15');
INSERT INTO "settings" VALUES('login_state_qGKcWnjpMXzytXcU2e-oHBpCLllT_0wHwz22eK4IuPw','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-21 15:54:47');
INSERT INTO "settings" VALUES('login_state_n1r6geHWb2nORViFNTOFLrKEm_BZGAayNpTHbZb1DZY','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-21 15:55:13');
INSERT INTO "settings" VALUES('login_state_RIkaeJOo8OZ_adDo2_fL2X4pMDblPnQEqVFmeSzUN0Y','https://encrypt-unvocal-hankering.ngrok-free.dev/api/auth/google/callback|||/','2026-10-22 15:11:16');
INSERT INTO "settings" VALUES('login_state_PrLIjw4dIcOh6nY5lsYO1ZjEGE7sxi4vfcfBfrE60aE','http://localhost:5005/api/auth/google/callback|||/','2026-11-11 09:45:26');
CREATE TABLE "stock_in_logs" (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        drug_id INTEGER,
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
                        created_at TEXT NOT NULL, is_voided INTEGER DEFAULT 0, void_reason TEXT, voided_by TEXT, voided_at TEXT, lot_id INTEGER,
                        FOREIGN KEY (drug_id) REFERENCES drugs (id) ON DELETE SET NULL
                    );
INSERT INTO "stock_in_logs" VALUES(1,1,'MED-001','Paracetamol 500','',1,5,6,0.0,0.0,'บริษัท','2030-08-08','waraporn seehanach','','2026-10-17 14:58:58',1,'ยกเลิกรายการรับเข้าโดยเจ้าหน้าที่','waraporn seehanach (warapornseehanach@gmail.com)','2026-10-17 14:59:27',NULL);
INSERT INTO "stock_in_logs" VALUES(2,1,'MED-001','Paracetamol 500','',2,4,6,0.0,0.0,'บริษัท','2030-08-08','waraporn seehanach','','2026-10-17 15:00:53',1,'ยกเลิกรายการรับเข้าโดยเจ้าหน้าที่','waraporn seehanach (warapornseehanach@gmail.com)','2026-10-17 15:06:39',NULL);
INSERT INTO "stock_in_logs" VALUES(3,1,'MED-001','Paracetamol 500','LOT-240801',10,5,15,5.0,50.0,'องค์การเภสัชกรรม (GPO)','2030-08-08','เภสัชกร/เจ้าหน้าที่','','2026-10-17 15:16:20',1,'ทดสอบระบบ Lot','เจ้าหน้าที่','2026-10-17 15:16:36',NULL);
INSERT INTO "stock_in_logs" VALUES(4,1,'MED-001','Paracetamol 500','LOT-240801',2,5,7,70.0,140.0,'บริษัท','2030-08-08','waraporn seehanach','','2026-10-17 16:19:52',1,'ยกเลิกรายการรับเข้าโดยเจ้าหน้าที่','waraporn seehanach (warapornseehanach@gmail.com)','2026-10-17 16:27:48',NULL);
INSERT INTO "stock_in_logs" VALUES(10,2,'MED-002','Albendazole 400mg/20ml suspension','LOT-261118',2,20,22,14.5,29.0,'องค์การเภสัชกรรม (GPO)','2028-06-25','waraporn seehanach','','2026-11-18 13:13:17',0,NULL,NULL,NULL,11);
INSERT INTO "stock_in_logs" VALUES(11,4,'MED-004','Albendazole 200 mg tab','A690271',200,0,200,165.0,33000.0,'องค์การเภสัชกรรม (GPO)','','waraporn seehanach','','2026-11-18 13:17:14',0,NULL,NULL,NULL,12);
INSERT INTO "stock_in_logs" VALUES(12,4,'MED-004','Albendazole 200 mg tab','A690271',200,200,400,165.0,33000.0,'องค์การเภสัชกรรม (GPO)','2029-03-04','waraporn seehanach','','2026-11-18 13:23:08',0,NULL,NULL,NULL,12);
CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT DEFAULT '',
                picture_url TEXT DEFAULT '',
                google_sub TEXT DEFAULT '',
                last_login TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TEXT
            );
INSERT INTO "users" VALUES(1,'s6606021631050@email.kmutnb.ac.th','WEERAPHAT CHUENCHOB','https://lh3.googleusercontent.com/a/ACg8ocKrISfpFu0ad3KnC2B9zpdpVGDHkuFG7WN9-stFCsX5h54Ekw=s96-c','108784496881076725792','2026-10-16 15:41:48',1,'2026-10-14 19:47:44');
INSERT INTO "users" VALUES(3,'mxmm2547@gmail.com','FU TRUE','https://lh3.googleusercontent.com/a/ACg8ocJ3A63D56LqrLUvRSfot87xvehZHWhdOj7ogZ_ttUAgGvU63tVx=s96-c','110259746189987566609','2026-10-16 18:01:02',1,'2026-10-14 19:51:52');
INSERT INTO "users" VALUES(7,'warapornseehanach@gmail.com','waraporn seehanach','https://lh3.googleusercontent.com/a/ACg8ocIdHczMm9Uon9wflAb9Swq5HpJyMfa-fgQqod6k2AFfwfbbJQ=s96-c','100528804137992288679','2026-10-22 15:11:21',1,'2026-10-14 21:11:07');
INSERT INTO "users" VALUES(8,'nichatongyou301147@gmail.com','นางสาวณิชา ทองอยู่','https://lh3.googleusercontent.com/a/ACg8ocL3kZnn0Mc14T2d911J1rzDyo_Jb2qk3OsgQC7uDaDCNpVbNdM9=s96-c','105222710892074525331','2026-10-14 21:57:42',1,'2026-10-14 21:57:42');
INSERT INTO "users" VALUES(30,'aabb78231@gmail.com','Supihsara Tanai','https://lh3.googleusercontent.com/a/ACg8ocLfiHLxG1LN_JfQQla8rXpRW8CbcpalyQBIxDN-KSLPWYUTACw=s96-c','112028042209337963580','2026-10-17 16:23:26',1,'2026-10-17 14:45:08');
INSERT INTO "users" VALUES(35,'chaichana.toomjan@gmail.com','Chaichana Toomjan','https://lh3.googleusercontent.com/a/ACg8ocJ6UZO9Khp7QZ2RqGylC_5EklVe3xwIE1ouCPazwzisCUszCgCj=s96-c','112141852174125725584','2026-10-17 17:04:18',1,'2026-10-17 17:04:18');
CREATE INDEX idx_drugs_name ON drugs(name);
CREATE INDEX idx_drugs_code ON drugs(code);
CREATE INDEX idx_logs_created ON dispensing_logs(created_at);
CREATE INDEX idx_subscribers_target ON line_subscribers(target_id);
CREATE INDEX idx_audit_email ON audit_logs(user_email);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_stock_in_created ON stock_in_logs(created_at);
CREATE INDEX idx_stock_in_drug ON stock_in_logs(drug_id);
CREATE INDEX idx_logs_batch_id ON dispensing_logs(batch_id);
CREATE INDEX idx_drug_lots_drug ON drug_lots(drug_id);
CREATE INDEX idx_drug_lots_exp ON drug_lots(expiry_date);
DELETE FROM "sqlite_sequence";
INSERT INTO "sqlite_sequence" VALUES('line_subscribers',36);
INSERT INTO "sqlite_sequence" VALUES('users',38);
INSERT INTO "sqlite_sequence" VALUES('categories',21);
INSERT INTO "sqlite_sequence" VALUES('audit_logs',56);
INSERT INTO "sqlite_sequence" VALUES('drugs',6);
INSERT INTO "sqlite_sequence" VALUES('stock_in_logs',12);
INSERT INTO "sqlite_sequence" VALUES('dispensing_logs',4);
INSERT INTO "sqlite_sequence" VALUES('drug_lots',12);
COMMIT;
