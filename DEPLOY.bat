@echo off
REM Puts your friend online (free Cloudflare account) so it works on your phone + PC,
REM even when this PC is off. Safe to re-run any time you change the persona or code.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1
pause
