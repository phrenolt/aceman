@echo off
setlocal EnableExtensions

:: --- self-elevate to Administrator ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    if "%~1"=="" (
        powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    ) else (
        powershell -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
    )
    exit /b
)

if /i "%~1"=="phase2" goto phase2

:: ================= PHASE 1: enable WSL, then reboot =================
echo === Phase 1: enabling WSL (no distro yet) ===

:: schedule phase 2 to auto-run at next login
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" ^
    /v AcemanSetup /t REG_SZ /d "\"%~f0\" phase2" /f

:: enable WSL itself WITHOUT a distro - distro install happens in phase 2,
:: after the reboot, when the feature is actually active.
wsl --install --no-distribution
wsl --set-default-version 2

echo.
echo WSL enabled. A reboot is needed before a distro can be installed.
echo Phase 2 (install Ubuntu + provision) runs automatically after login.
echo.
echo IMPORTANT: phase 2 downloads Ubuntu, packages and the repo, so it
echo needs INTERNET right after reboot. Make sure WiFi connects
echo automatically at startup (disable any "WiFi off at boot" setting).
echo.
choice /c YN /m "Is WiFi set to connect on startup, ready to reboot"
if errorlevel 2 (
    echo.
    echo Skipped. Reboot yourself when ready - phase 2 runs at next login.
    echo Or run manually after reboot:  "%~f0" phase2
    pause
    exit /b
)
shutdown /r /t 5
exit /b

:: ================= PHASE 2: install distro + provision =================
:phase2
echo === Phase 2: installing Ubuntu + provisioning ===

:: feature is active now - actually install the distro
echo Installing Ubuntu...
wsl --install -d Ubuntu --no-launch

:: wait until the distro is registered AND runnable before provisioning
echo Waiting for Ubuntu to be ready...
set /a tries=0
:waitloop
set /a tries+=1
wsl -d Ubuntu -u root -- true >nul 2>&1
if not errorlevel 1 goto ready
if %tries% geq 36 goto notready
timeout /t 5 /nobreak >nul
goto waitloop

:notready
echo.
echo Ubuntu did not become ready in time. Check "wsl --list --verbose",
echo then re-run:  "%~f0" phase2
pause
exit /b

:ready
:: resolve the wsl path of setup.sh sitting next to this .bat
for /f "delims=" %%i in ('wsl wslpath -a "%~dp0setup.sh"') do set "SH=%%i"

:: strip CRLF and run as root inside Ubuntu
wsl -d Ubuntu -u root -- bash -c "tr -d '\r' < '%SH%' | bash"

:: create the Windows Desktop shortcut (arg = run silently, no extra pause)
echo Creating Desktop shortcut...
call "%~dp0shortcut.bat" silent

:: setup.sh wrote /etc/wsl.conf (systemd=true + default user). Those only
:: apply on a fresh boot of the distro, so shut it down now - the next
:: launch (run.bat) starts with systemd and logs in as the 'ace' user.
echo Applying WSL config (systemd + default user)...
wsl --shutdown

echo.
echo === Done. Launch with run.bat, or open Ubuntu and run: ===
echo ===   cd ~/Projects/aceman ^&^& ./aceman_web                ===
pause
exit /b
