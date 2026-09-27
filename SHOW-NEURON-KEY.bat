@echo off
REM Prints the one line your brain host needs. Only use this if someone else runs your neurons.
cd /d "%~dp0"
node scripts\neuro-secret.mjs --show
pause
