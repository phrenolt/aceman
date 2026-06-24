@echo off
setlocal EnableExtensions
title aceman update

echo ============================================================
echo  Update aceman
echo ------------------------------------------------------------
echo  Runs 'git pull' inside the WSL project (~/Projects/aceman)
echo  to fetch the latest code from GitHub.
echo ============================================================
echo.
echo  TRUST NOTE: this pulls code from the internet that will run
echo  on your machine on the next launch. Only proceed if you trust
echo  the project author and have reviewed the repository:
echo.
echo      https://github.com/curiousconcept/aceman
echo.
choice /c YN /m "Pull the latest code now"
if errorlevel 2 (
    echo Cancelled. Nothing changed.
    pause
    exit /b
)

echo.
echo Pulling...
wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman && git pull --ff-only"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo Update complete. Launch with run.bat or the Desktop shortcut.
) else (
    echo git pull did not complete cleanly ^(exit %RC%^). You may have
    echo local changes or a diverged branch. Open Ubuntu and check:
    echo     cd ~/Projects/aceman ^&^& git status
)
pause
exit /b
