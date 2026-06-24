@echo off
setlocal EnableExtensions
title aceman launcher

echo ============================================================
echo  Launching aceman_web
echo ------------------------------------------------------------
echo  A SECOND window opens with the LIVE server logs.
echo   - Keep that window open while you use aceman.
echo   - Close it (or Ctrl+C in it) to stop the server.
echo  THIS window waits for the URL, then opens your browser.
echo ============================================================
echo.

:: Truncate the web log first so we read THIS run's URL, not a stale one.
wsl -d Ubuntu -- bash -lc "mkdir -p ~/.cache/aceman; : > ~/.cache/aceman/web.log" 2>nul

:: Server in its OWN window = real TTY = live, unbuffered logs. The
:: trailing 'read' keeps the window open after the server stops so any
:: error stays visible.
start "aceman_web - live logs (keep open)" wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman && ./aceman_web; echo; echo [server stopped - press Enter to close]; read _"

echo Waiting for the server URL (first launch builds images, can take a few minutes)
set "URL="
for /l %%n in (1,1,120) do (
    <nul set /p "=."
    for /f "usebackq delims=" %%u in (`wsl -d Ubuntu -- bash -lc "grep -oP 'open in Windows browser: \Khttp\S+' ~/.cache/aceman/web.log 2>/dev/null | tail -1"`) do set "URL=%%u"
    if defined URL goto goturl
    timeout /t 3 /nobreak >nul
)
echo.
echo Timed out waiting for the URL. Check the live-logs window for errors.
pause
exit /b

:goturl
echo.
echo Found URL: %URL%
echo Waiting for it to respond, then opening your browser...
powershell -NoProfile -Command "for($i=0;$i -lt 40;$i++){ try{ Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 '%URL%' | Out-Null; break }catch{ Start-Sleep -Milliseconds 700 } }; Start-Process '%URL%'"
echo.
echo Opened %URL% in your browser.
echo The server keeps running in the other window. Close it to stop aceman.
pause
exit /b
