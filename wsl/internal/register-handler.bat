@echo off
setlocal EnableExtensions
title aceman - register acestream:// handler

:: This script lives in wsl/internal/. get_url_stream.bat is one level up.
set "HERE=%~dp0"
for %%I in ("%HERE%..") do set "PARENT=%%~fI"
set "GETURL=%PARENT%\get_url_stream.bat"

:: Require a Windows player first — without VLC or mpv there's nothing to
:: hand the stream to, so registering the handler would be pointless.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$vlc=@(($env:ProgramFiles + '\VideoLAN\VLC\vlc.exe'), (${env:ProgramFiles(x86)} + '\VideoLAN\VLC\vlc.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1; $mpv=(Get-Command mpv -ErrorAction SilentlyContinue).Source; if($vlc -or $mpv){ exit 0 } else { exit 1 }"
if errorlevel 1 goto noplayer

:: Register the per-user acestream:// URL protocol -> get_url_stream.bat.
:: %%1 becomes a literal %1 in the registry value (filled with the clicked
:: URL by Windows); "auto" makes get_url_stream.bat play without prompting.
reg add "HKCU\Software\Classes\acestream" /ve /d "URL:acestream Protocol" /f >nul
reg add "HKCU\Software\Classes\acestream" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\acestream\shell\open\command" /ve /d "\"%GETURL%\" \"%%1\" auto" /f >nul

echo.
echo Registered: acestream:// links now open via
echo   %GETURL%
echo Clicking an acestream:// link (including Play in the aceman web UI)
echo will play it in your Windows VLC/mpv.
echo Note: this points at the current folder; if you move it, re-run this.
if "%~1"=="" pause
exit /b

:noplayer
echo.
echo Handler registration FAILED: no VLC or mpv found on Windows.
echo Install VLC (https://videolan.org) or mpv, then run this again.
if "%~1"=="" pause
exit /b 1
