@echo off
rem Запуск фронтенду NeVpade (Vite).
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist .env copy .env.example .env >nul
call npm run dev
pause
