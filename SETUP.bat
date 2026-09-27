@echo off
REM First-time setup. Asks your name, makes your settings file, then (optionally)
REM runs your friend locally at http://localhost:8799 so you can try it.
cd /d "%~dp0"
if not exist node_modules call npm install --no-audit --no-fund
call node scripts\set-name.mjs
if not exist .dev.vars (
  copy .dev.vars.example .dev.vars >nul
  call node scripts\gen-vapid.mjs
)
call node scripts\neuro-secret.mjs
echo.
echo  Notepad will open your settings. Set APP_PASSWORD and paste your API key(s).
echo  Save (Ctrl+S) and close Notepad to continue.
notepad .dev.vars
call npx wrangler d1 execute homie --local --file schema.sql >nul
echo.
choice /M "Try it on this PC now (opens a browser)"
if errorlevel 2 goto done
start "" http://localhost:8799
call npx wrangler dev --test-scheduled --port 8799
:done
echo Setup done. Next: DEPLOY.bat
pause
