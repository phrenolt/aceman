@echo off
setlocal EnableExtensions

:: restore_from_downloads.bat - restore aceman favourites from a backup folder
:: in your Windows Downloads (made by backup_to_downloads.bat) back into WSL.
:: Runs restore_from_downloads.sh inside WSL against your Windows Downloads;
:: with no arg it restores the newest aceman-backup-* folder there.

:: Resolve %UserProfile%\Downloads to a WSL path (/mnt/c/...).
set "WINDL=%UserProfile%\Downloads"
set "WSLDL="
for /f "delims=" %%i in ('wsl -d Ubuntu -- wslpath -a "%WINDL%" 2^>nul') do set "WSLDL=%%i"
if not defined WSLDL (
    echo Could not resolve your Windows Downloads folder in WSL.
    pause
    exit /b 1
)

wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman && ACE_DOWNLOADS='%WSLDL%' ./restore_from_downloads.sh"
echo.
pause
exit /b
