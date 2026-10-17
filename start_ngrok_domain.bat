@echo off
chcp 65001 >nul
title Ngrok Free Static Domain Tunnel
echo ========================================================
echo    🌐 กำลังเปิดใช้งาน Domain ถาวร (Ngrok Free Domain)
echo ========================================================
echo.

set "NGROK_EXE=C:\Users\USER\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"

echo โดเมนของคุณคือ: https://encrypt-unvocal-hankering.ngrok-free.dev
echo กำลังเชื่อมต่อไปยัง http://localhost:5005 ...
echo กด Ctrl+C เพื่อหยุดการทำงาน
echo --------------------------------------------------------
"%NGROK_EXE%" http 5005 --url encrypt-unvocal-hankering.ngrok-free.dev
pause
