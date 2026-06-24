@echo off
setlocal EnableExtensions
title aceman stop

echo Stopping aceman (web + engine) and shutting down WSL...

:: Graceful first: ask the web to shut down and stop the engine container.
:: (Both run with --rm, so wsl --shutdown would drop them anyway, but a
:: clean stop lets the web post /api/shutdown and the engine exit nicely.)
wsl -d Ubuntu -- bash -lc "cd ~/Projects/aceman && ./aceman_web --stop 2>/dev/null; podman stop ace 2>/dev/null; true"

echo Shutting down WSL...
wsl --shutdown

echo.
echo Done. aceman containers stopped and WSL is shut down.
pause
exit /b
