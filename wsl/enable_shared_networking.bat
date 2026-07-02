@echo off
setlocal EnableExtensions

:: enable_shared_networking.bat - switch WSL2 to "mirrored" networking so a
:: player on ANOTHER device (a phone/tablet with VLC) can reach the aceman
:: engine over your LAN. Editing %UserProfile%\.wslconfig and restarting WSL
:: are both per-user, so this needs NO admin.
::
:: Run two ways:
::   double-click              full security warning + confirm, then restart WSL
::   ...bat silent             no prompt, no restart - install.bat drives both
::                             (it shows its own note and restarts WSL once)

set "SILENT="
if /i "%~1"=="silent" set "SILENT=1"

:: Mirrored networking needs Windows 11 22H2 (build 22621) or newer. On
:: older builds the setting is silently ignored, so warn before writing it.
set "BUILD=0"
for /f "delims=" %%b in ('powershell -NoProfile -Command "[Environment]::OSVersion.Version.Build"') do set "BUILD=%%b"
if %BUILD% lss 22621 (
    echo.
    echo   WARNING: mirrored networking needs Windows 11 22H2 or newer
    echo   ^(build 22621+^). This PC reports build %BUILD%, which will
    echo   likely IGNORE the setting - another-device playback will not
    echo   work this way on this Windows version.
    echo.
    if defined SILENT exit /b 2
    choice /c YN /m "Write the setting anyway"
    if errorlevel 2 exit /b 1
)

if not defined SILENT (
    echo.
    echo   ================= SECURITY WARNING =================
    echo   This switches WSL to "mirrored" networking, so WSL shares
    echo   your Windows network interfaces. It changes networking for
    echo   ALL of WSL, not just aceman.
    echo.
    echo   Afterwards, ticking "Expose engine on local network" in the
    echo   aceman UI makes the engine reachable by ANY device on your
    echo   LAN. aceman still blocks web-browser drive-by requests, but
    echo   there is NO password. Only enable this on a network you
    echo   trust - never on public or shared Wi-Fi.
    echo.
    echo   To undo later: delete the networkingMode line from
    echo   %UserProfile%\.wslconfig ^(a backup is saved first^), then
    echo   run: wsl --shutdown
    echo   ===================================================
    echo.
    choice /c YN /m "Enable mirrored networking now"
    if errorlevel 2 (
        echo Skipped. Nothing changed.
        exit /b 1
    )
)

:: Back up the pristine .wslconfig once, then set networkingMode=mirrored
:: idempotently: drop any existing networkingMode line, add a [wsl2] section
:: if none exists, and insert the setting right after it.
set "CFG=%UserProfile%\.wslconfig"
if exist "%CFG%" if not exist "%CFG%.aceman-backup" copy /y "%CFG%" "%CFG%.aceman-backup" >nul

powershell -NoProfile -Command ^
  "$cfg = Join-Path $env:USERPROFILE '.wslconfig';" ^
  "$lines = if (Test-Path -LiteralPath $cfg) { @(Get-Content -LiteralPath $cfg) } else { @() };" ^
  "$lines = $lines | Where-Object { $_ -notmatch 'networkingMode' };" ^
  "if (-not ($lines | Where-Object { $_ -match '\[wsl2\]' })) { $lines = @('[wsl2]') + $lines };" ^
  "$out = New-Object System.Collections.Generic.List[string];" ^
  "$done = $false;" ^
  "foreach ($l in $lines) { $out.Add($l); if (-not $done -and $l -match '\[wsl2\]') { $out.Add('networkingMode=mirrored'); $done = $true } };" ^
  "Set-Content -LiteralPath $cfg -Value $out -Encoding ASCII"
if errorlevel 1 (
    echo.
    echo   FAILED to update %CFG% - nothing changed there.
    if not defined SILENT pause
    exit /b 1
)

echo.
echo   networkingMode=mirrored written to %CFG%.

:: In silent (install-driven) mode, install.bat restarts WSL itself.
if defined SILENT exit /b 0

echo   Restarting WSL so it takes effect ^(this stops any running aceman^)...
wsl --shutdown
echo.
echo   Done. Relaunch aceman with run.bat, tick "Expose engine on local
echo   network" in the UI, then scan the QR from your phone/tablet - it
echo   now shows your real LAN IP.
pause
exit /b 0
