@echo off
rem Запускає бекенд і фронтенд NeVpade в окремих вікнах.
cd /d "%~dp0"
start "NeVpade backend" cmd /k backend\run.bat
start "NeVpade frontend" cmd /k frontend\run.bat
