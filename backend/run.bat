@echo off
rem Запуск бекенду NeVpade: створює venv (якщо нема), ставить пакети й запускає сервер.
rem Не потребує activate, тож працює навіть коли PowerShell блокує скрипти.
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
  echo Створюю venv...
  python -m venv venv || (echo Не знайдено Python. Встановіть Python 3.11+ & pause & exit /b 1)
)
if not exist .env (
  copy .env.example .env >nul
  echo Створено backend\.env — заповніть MONGODB_URI і JWT_SECRET і запустіть знову.
  pause & exit /b 1
)
venv\Scripts\python.exe -m pip install -q --disable-pip-version-check -r requirements.txt
echo.
echo API:     http://127.0.0.1:8000/api
echo Swagger: http://127.0.0.1:8000/docs
echo.
venv\Scripts\python.exe -m uvicorn main:app --reload
pause
