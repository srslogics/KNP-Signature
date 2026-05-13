@echo off
setlocal
cd /d "%~dp0"

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

if not exist "%STARTUP_DIR%" (
  echo Startup folder not found.
  pause
  exit /b 1
)

copy /Y "%~dp0start_knp_signature_hidden.vbs" "%STARTUP_DIR%\KNP Signature.vbs" >nul

echo.
echo KNP Signature auto-start has been installed.
echo From next Windows startup, the print service will start automatically.
echo.
pause
exit /b 0
