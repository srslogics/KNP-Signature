@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 clear_business_data_keep_parties.py
) else (
  python clear_business_data_keep_parties.py
)

echo.
pause
