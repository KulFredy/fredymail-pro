@echo off
chcp 65001 >nul
title FredyMail Pro — Başlatıcı

echo ================================================
echo   FredyMail Pro — Tam Kurulum ve Başlatma
echo ================================================
echo.

:: ── 1. index.html yamala ────────────────────────
echo [1/6] index.html yamalanıyor...
cd /d "D:\msi\Desktop\fredymail-pro\frontend"
python patch_index.py
if errorlevel 1 (
    echo HATA: patch_index.py çalışmadı!
    pause
    exit /b 1
)
echo.

:: ── 2. pip bağımlılıkları ───────────────────────
echo [2/6] Python bağımlılıkları kuruluyor...
cd /d "D:\msi\Desktop\fredymail-pro\backend"
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo HATA: pip install başarısız!
    pause
    exit /b 1
)
echo     Tamamlandı.
echo.

:: ── 3. Meilisearch ──────────────────────────────
echo [3/6] Meilisearch başlatılıyor...
cd /d "D:\Mail_Arama_Motoru"
start "Meilisearch" cmd /k "meilisearch.exe --master-key 700m_2026_Mail"
timeout /t 3 /nobreak >nul
echo     Meilisearch açıldı (port 7700).
echo.

:: ── 4. Meilisearch ayarları (reindex) ──────────
echo [4/6] Meilisearch index ayarları yapılıyor...
timeout /t 2 /nobreak >nul
curl -s -X POST http://localhost:8000/reindex >nul 2>&1
:: (backend henüz açık değilse bu adım atlanır, sorun değil)
echo     Reindex isteği gönderildi.
echo.

:: ── 5. Backend (FastAPI) ────────────────────────
echo [5/6] Backend API başlatılıyor (port 8000)...
cd /d "D:\msi\Desktop\fredymail-pro\backend"
start "FredyMail Backend" cmd /k "uvicorn app:app --host 0.0.0.0 --port 8000 --reload"
timeout /t 4 /nobreak >nul
echo     Backend açıldı.
echo.

:: ── 5b. Reindex (backend açıldıktan sonra) ──────
curl -s -X POST http://localhost:8000/reindex >nul 2>&1
echo     Reindex tamamlandı.
echo.

:: ── 6. Mail poller ──────────────────────────────
echo [6/6] Mail poller başlatılıyor...
cd /d "D:\Mail_Arama_Motoru"
start "Mail Otonom" cmd /k "python mail_otonom.py"
echo     Mail poller açıldı.
echo.

:: ── 7. Cloudflare tunnel ────────────────────────
echo [+] Cloudflare tunnel başlatılıyor...
start "Cloudflare Tunnel" cmd /k "cloudflared.exe tunnel run"
echo     Cloudflare açıldı.
echo.

echo ================================================
echo   Tüm servisler başlatıldı!
echo.
echo   Frontend : D:\msi\Desktop\fredymail-pro\frontend\index.html
echo   Backend  : http://localhost:8000
echo   Meili    : http://localhost:7700
echo   Public   : https://fredymailsearch.online
echo ================================================
echo.
pause
