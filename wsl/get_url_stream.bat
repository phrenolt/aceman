@echo off
setlocal EnableExtensions
title aceman - get stream URL

:: Accept the Ace Stream id as an argument, or prompt for it.
set "ACEID=%~1"
if "%ACEID%"=="" set /p "ACEID=Enter Ace Stream id (40-hex or acestream://...): "
if "%ACEID%"=="" (
    echo No id given.
    pause
    exit /b
)

:: Proxy to aceman in WSL. In WSL mode aceman resolves the id, starts the
:: engine if needed, and prints a playback URL reachable from Windows (the
:: WSL guest IP) WITHOUT launching a Linux player. We grab that URL, copy
:: it to the clipboard, and offer to open it in Windows VLC/mpv.
:: NOTE: keep all PowerShell strings single-quoted (no escaped \") so cmd
:: quoting stays intact.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$id='%ACEID%'; Write-Host 'Resolving via aceman in WSL (starts the engine if needed)...'; $out = wsl -d Ubuntu -- bash -lc ('cd ~/Projects/aceman && ./aceman ' + $id) 2>$null; $m = $out | Select-String -Pattern 'http://\S+' | Select-Object -Last 1; if(-not $m){ Write-Host 'Could not resolve a stream URL. Is the engine image built (engine.tar.gz placed)?' -ForegroundColor Red; exit 1 }; $url = $m.Matches[0].Value; Set-Clipboard $url; Write-Host ''; Write-Host 'Stream URL (copied to clipboard):' -ForegroundColor Cyan; Write-Host ('  ' + $url); $vlc = @(($env:ProgramFiles + '\VideoLAN\VLC\vlc.exe'), (${env:ProgramFiles(x86)} + '\VideoLAN\VLC\vlc.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1; $mpv = (Get-Command mpv -ErrorAction SilentlyContinue).Source; Write-Host ''; if($vlc){ $a = Read-Host 'Open in VLC now? [Y/N]'; if($a -match '^[Yy]'){ Start-Process $vlc -ArgumentList $url } } elseif($mpv){ $a = Read-Host 'Open in mpv now? [Y/N]'; if($a -match '^[Yy]'){ Start-Process $mpv -ArgumentList $url } } else { Write-Host 'No VLC/mpv found in the usual spots. Paste the URL into your player: Open Network Stream.' }"

echo.
pause
exit /b
