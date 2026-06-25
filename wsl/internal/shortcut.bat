@echo off
setlocal EnableExtensions

:: This script lives in wsl/internal/. The launcher (run.bat) and the
:: user-facing files live one level up in wsl/. HERE = this folder
:: (holds aceman.ico); PARENT = wsl/ (holds run.bat).
set "HERE=%~dp0"
for %%I in ("%HERE%..") do set "PARENT=%%~fI"

:: Create a Desktop shortcut "aceman" that runs run.bat (parent folder)
:: with the aceman icon (this folder). Uses the real Desktop path
:: (handles OneDrive redirection).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $lnk=Join-Path $ws.SpecialFolders.Item('Desktop') 'aceman.lnk'; $sc=$ws.CreateShortcut($lnk); $sc.TargetPath=Join-Path '%PARENT%' 'run.bat'; $sc.WorkingDirectory='%PARENT%'; $sc.IconLocation=(Join-Path '%HERE%' 'aceman.ico'); $sc.Description='Launch aceman_web in WSL'; $sc.Save(); Write-Host ('Created: ' + $lnk)"

echo.
echo Done. Look for the 'aceman' icon on your Desktop - double-click to launch.
:: when called with an argument (e.g. from install.bat) skip the pause
if "%~1"=="" pause
exit /b
