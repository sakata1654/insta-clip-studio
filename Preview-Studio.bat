@echo off
cd /d "%~dp0"
echo Building Svelte UI and starting Insta Clip Studio Live Preview (no Rust build required)...
call npm run preview
pause
