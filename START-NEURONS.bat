@echo off
REM Runs the spiking-neuron "feeling layer" on this PC. Leave this window open
REM (or set it to start at login, see README). Close it and the app falls back
REM to the float model until it's back; the neurons catch up when it restarts.
cd /d "%~dp0"
if exist neuro\config.json goto run
echo First time: where is your app? Press Enter for local testing, or paste your workers.dev URL.
set "URL="
set /p URL="URL: "
call node neuro\setup.mjs %URL%
echo.
echo  IMPORTANT: if you pasted a workers.dev URL, run DEPLOY.bat once more so the app gets the new secret.
echo.
:run
node neuro\service.mjs
pause
