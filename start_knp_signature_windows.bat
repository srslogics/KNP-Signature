@echo off
setlocal
cd /d "%~dp0"

set "EXE_PATH=%~dp0dist\KNP Signature Print Service.exe"

curl -s http://127.0.0.1:9876/health >nul 2>nul
if errorlevel 1 (
  if exist "%EXE_PATH%" (
    start "" /min "%EXE_PATH%"
  ) else (
    where py >nul 2>nul
    if %errorlevel%==0 (
      start "" /min py -3w print_bridge.py
    ) else (
      start "" /min pythonw print_bridge.py
    )
  )
)

start "" "%~dp0frontend\index.html"

exit /b 0
