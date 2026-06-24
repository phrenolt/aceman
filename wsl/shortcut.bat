@echo off
setlocal EnableExtensions

:: Folder this script lives in (keeps the trailing backslash; Join-Path
:: in the PowerShell below handles it fine).
set "HERE=%~dp0"

:: Create a Desktop shortcut "aceman" that runs run.bat with the aceman
:: icon. Uses the real Desktop path (handles OneDrive redirection).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $lnk=Join-Path $ws.SpecialFolders.Item('Desktop') 'aceman.lnk'; $sc=$ws.CreateShortcut($lnk); $sc.TargetPath=Join-Path '%HERE%' 'run.bat'; $sc.WorkingDirectory='%HERE%'; $sc.IconLocation=(Join-Path '%HERE%' 'aceman.ico'); $sc.Description='Launch aceman_web in WSL'; $sc.Save(); Write-Host ('Created: ' + $lnk)"

echo.
echo Done. Look for the 'aceman' icon on your Desktop - double-click to launch.
:: when called with an argument (e.g. from install.bat) skip the pause
if "%~1"=="" pause
exit /b
