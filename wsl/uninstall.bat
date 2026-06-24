@echo off
setlocal EnableExtensions

:: --- self-elevate to Administrator ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo === aceman WSL uninstaller ===
echo.
echo Currently installed distros:
wsl --list --verbose
echo.
echo This will:
echo   1. Unregister (DELETE) the Ubuntu distro and ALL its files
echo   2. Uninstall the WSL app itself
echo.
echo *** This permanently deletes everything inside the distro. ***
echo.
choice /c YN /m "Continue"
if errorlevel 2 (
    echo Aborted. Nothing was changed.
    pause
    exit /b
)

:: clear any leftover auto-resume key from the installer
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\RunOnce" /v AcemanSetup /f >nul 2>&1

echo.
echo Shutting down WSL...
wsl --shutdown

echo Unregistering Ubuntu distro...
wsl --unregister Ubuntu

echo Uninstalling the WSL app...
wsl --uninstall

echo.
echo === Uninstall complete. ===
echo You may also delete leftover files manually:
echo   %%USERPROFILE%%\.wslconfig
echo   %%LOCALAPPDATA%%\Packages\CanonicalGroupLimited*
pause
exit /b
