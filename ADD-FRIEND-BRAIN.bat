@echo off
REM Host a friend's brain on this PC next to yours. Their chats, memory and app
REM stay on their own account; this PC only receives numbers (how things landed).
cd /d "%~dp0"
node neuro\add-brain.mjs
pause
