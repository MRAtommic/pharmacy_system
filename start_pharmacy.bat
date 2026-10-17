@echo off
chcp 65001 >nul
title Pharmacy Management System
echo ========================================================
echo    🏥 กำลังเริ่มต้นระบบคลังยา (Pharmacy Management System)
echo ========================================================
echo.
cd /d "%~dp0"
set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"

if not exist "%PYTHON_EXE%" (
    set "PYTHON_EXE=python"
)

echo เปิดใช้งานระบบที่: http://127.0.0.1:5005
echo กด Ctrl+C เพื่อหยุดการทำงาน
echo --------------------------------------------------------
start http://127.0.0.1:5005
"%PYTHON_EXE%" run_pharmacy.py
pause
