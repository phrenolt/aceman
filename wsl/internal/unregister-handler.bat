@echo off
setlocal EnableExtensions
title aceman - unregister acestream:// handler

reg delete "HKCU\Software\Classes\acestream" /f >nul 2>&1 && (
    echo Unregistered the acestream:// handler.
) || (
    echo No acestream:// handler was registered.
)
if "%~1"=="" pause
exit /b
