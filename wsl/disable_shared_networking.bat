@echo off
setlocal EnableExtensions

:: disable_shared_networking.bat - revert WSL2 to its default (NAT)
:: networking by removing the mirrored-mode setting aceman added, then
:: restarting WSL. Per-user, no admin. Undoes enable_shared_networking.bat.

set "CFG=%UserProfile%\.wslconfig"

if not exist "%CFG%" (
    echo No %CFG% found - shared networking was never enabled here.
    echo Nothing to do.
    pause
    exit /b 0
)

echo.
echo   This reverts WSL to its default ^(NAT^) networking by removing the
echo   networkingMode line from %CFG%, then restarts WSL. Other devices on
echo   your LAN will no longer be able to reach the aceman engine.
echo.
choice /c YN /m "Disable shared networking now"
if errorlevel 2 (
    echo Skipped. Nothing changed.
    exit /b 1
)

:: Remove any networkingMode line; leave the rest of the file untouched.
powershell -NoProfile -Command ^
  "$cfg = Join-Path $env:USERPROFILE '.wslconfig';" ^
  "$lines = @(Get-Content -LiteralPath $cfg) | Where-Object { $_ -notmatch 'networkingMode' };" ^
  "Set-Content -LiteralPath $cfg -Value $lines -Encoding ASCII"
if errorlevel 1 (
    echo.
    echo   FAILED to update %CFG% - nothing changed there.
    pause
    exit /b 1
)

echo.
echo   Removed networkingMode from %CFG%.
echo   Restarting WSL so it takes effect ^(this stops any running aceman^)...
wsl --shutdown
echo.
echo   Done. WSL is back on default networking. Relaunch aceman with run.bat.
pause
exit /b 0
