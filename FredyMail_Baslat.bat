@echo off
chcp 65001 >nul
title FredyMail Pro
echo [1/5] Bagimliliklar kuruluyor...
cd /d "D:\msi\Desktop\fredymail-pro\backend"
pip install -r requirements.txt --quiet
echo [2/5] Meilisearch baslatiliyor...
cd /d "D:\Mail_Arama Motoru"
start "Meilisearch" cmd /k "meilisearch.exe --master-key 700m_2026_Mail"
timeout /t 5 /nobreak >nul
echo [3/5] Backend baslatiliyor...
cd /d "D:\msi\Desktop\fredymail-pro\backend"
start "Backend" cmd /k "uvicorn app:app --host 0.0.0.0 --port 8000 --reload"
timeout /t 6 /nobreak >nul
curl -s -X POST http://localhost:8000/reindex >nul 2>&1
echo [4/5] Mail poller baslatiliyor...
cd /d "D:\Mail_Arama Motoru"
start "Mail Otonom" cmd /k "python mail_otonom.py"
echo [5/5] Cloudflare baslatiliyor...
start "Cloudflare" cmd /k "cloudflared.exe tunnel --url http://127.0.0.1:8000 run fredymailpro"
echo Tum servisler acildi!
pause
