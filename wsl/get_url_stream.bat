@echo off
setlocal EnableExtensions
title aceman - get stream URL

:: Accept the Ace Stream id as arg 1, or prompt. Arg 2 = "auto" skips the
:: Open-in-player prompt and launches straight away (used by the
:: acestream:// protocol handler — see internal/register-handler.bat).
set "ACEID=%~1"
set "MODE=%~2"
if "%ACEID%"=="" set /p "ACEID=Enter Ace Stream id (40-hex or acestream://...): "
if "%ACEID%"=="" (
    echo No id given.
    pause
    exit /b
)

:: Proxy to aceman in WSL. We do this in two steps so the get-url path is
:: self-contained and does NOT depend on the web UI (aceman_web) having been
:: launched first to bring the engine up:
::   1. './aceman engine start' — idempotent; starts the engine container if
::      it isn't already running (prints "already running" otherwise). Its
::      output stays VISIBLE so the user sees the first-run image build
::      (~2 min) instead of an apparent hang.
::   2. './aceman <id>' in WSL mode — resolves the id against the now-running
::      engine and prints a playback URL reachable from Windows (the WSL guest
::      IP) WITHOUT launching a Linux player. We grab that URL, copy it to the
::      clipboard, and open it in Windows VLC/mpv.
:: NOTE: keep all PowerShell strings single-quoted (no escaped \") so cmd
:: quoting stays intact.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$id='%ACEID%'; $mode='%MODE%'; Write-Host 'Starting the Ace Stream engine if it is not already running (first run builds the image, ~2 min)...'; wsl -d Ubuntu -- bash -lc 'cd ~/Projects/aceman && ./aceman engine start' 2>&1 | ForEach-Object { Write-Host $_ }; if($LASTEXITCODE -ne 0){ Write-Host 'Could not start the engine. Is engine.tar.gz placed and podman working in WSL?' -ForegroundColor Red; exit 1 }; Write-Host ''; Write-Host 'Resolving stream URL via aceman in WSL...'; $out = wsl -d Ubuntu -- bash -lc ('cd ~/Projects/aceman && ./aceman ' + $id) 2>$null; $m = $out | Select-String -Pattern 'http://\S+' | Select-Object -Last 1; if(-not $m){ Write-Host 'Could not resolve a stream URL. Check the id is valid.' -ForegroundColor Red; exit 1 }; $url = $m.Matches[0].Value; Set-Clipboard $url; Write-Host ''; Write-Host 'Stream URL (copied to clipboard):' -ForegroundColor Cyan; Write-Host ('  ' + $url); $vlc = @(($env:ProgramFiles + '\VideoLAN\VLC\vlc.exe'), (${env:ProgramFiles(x86)} + '\VideoLAN\VLC\vlc.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1; $mpv = (Get-Command mpv -ErrorAction SilentlyContinue).Source; $player = if($vlc){$vlc}elseif($mpv){$mpv}else{$null}; Write-Host ''; if($player){ $name=[IO.Path]::GetFileNameWithoutExtension($player); if($mode -eq 'auto'){ Write-Host ('Opening in ' + $name + '...'); Start-Process $player -ArgumentList $url } else { $a = Read-Host ('Open in ' + $name + ' now? [Y/N]'); if($a -match '^[Yy]'){ Start-Process $player -ArgumentList $url } } } else { Write-Host 'No VLC/mpv found. Paste the URL into your player: Open Network Stream.' }"

:: In auto (handler) mode don't hold the window open.
if /i not "%MODE%"=="auto" pause
exit /b
