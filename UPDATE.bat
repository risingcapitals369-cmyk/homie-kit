@echo off
REM Gets the latest version from your friend and puts it online. Keeps your keys,
REM password, name and chats exactly as they are. Run it whenever he says there is an update.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\update.ps1
pause
