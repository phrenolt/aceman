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

:: Proxy to aceman in WSL. In WSL mode aceman resolves the id, starts the
:: engine if needed, and prints a playback URL reachable from Windows (the
:: WSL guest IP) WITHOUT launching a Linux player. We grab that URL, copy
:: it to the clipboard, and open it in Windows VLC/mpv.
:: NOTE: keep all PowerShell strings single-quoted (no escaped \") so cmd
:: quoting stays intact.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$id='%ACEID%'; $mode='%MODE%'; Write-Host 'Resolving via aceman in WSL (starts the engine if needed)...'; $out = wsl -d Ubuntu -- bash -lc ('cd ~/Projects/aceman && ./aceman ' + $id) 2>$null; $m = $out | Select-String -Pattern 'http://\S+' | Select-Object -Last 1; if(-not $m){ Write-Host 'Could not resolve a stream URL. Is the engine image built (engine.tar.gz placed)?' -ForegroundColor Red; exit 1 }; $url = $m.Matches[0].Value; Set-Clipboard $url; Write-Host ''; Write-Host 'Stream URL (copied to clipboard):' -ForegroundColor Cyan; Write-Host ('  ' + $url); $vlc = @(($env:ProgramFiles + '\VideoLAN\VLC\vlc.exe'), (${env:ProgramFiles(x86)} + '\VideoLAN\VLC\vlc.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1; $mpv = (Get-Command mpv -ErrorAction SilentlyContinue).Source; $player = if($vlc){$vlc}elseif($mpv){$mpv}else{$null}; Write-Host ''; if($player){ $name=[IO.Path]::GetFileNameWithoutExtension($player); if($mode -eq 'auto'){ Write-Host ('Opening in ' + $name + '...'); Start-Process $player -ArgumentList $url } else { $a = Read-Host ('Open in ' + $name + ' now? [Y/N]'); if($a -match '^[Yy]'){ Start-Process $player -ArgumentList $url } } } else { Write-Host 'No VLC/mpv found. Paste the URL into your player: Open Network Stream.' }"

:: In auto (handler) mode don't hold the window open.
if /i not "%MODE%"=="auto" pause
exit /b
