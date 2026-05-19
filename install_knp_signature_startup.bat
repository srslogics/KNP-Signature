@echo off
setlocal
cd /d "%~dp0"

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET_BAT=%~dp0start_knp_signature_windows.bat"
set "STARTUP_VBS=%STARTUP_DIR%\KNP Signature.vbs"

if not exist "%STARTUP_DIR%" (
  echo Startup folder not found.
  pause
  exit /b 1
)

if not exist "%TARGET_BAT%" (
  echo start_knp_signature_windows.bat was not found in:
  echo %~dp0
  pause
  exit /b 1
)

> "%STARTUP_VBS%" echo Set shell = CreateObject("WScript.Shell")
>> "%STARTUP_VBS%" echo shell.Run Chr(34^) ^& "%TARGET_BAT%" ^& Chr(34^) ^& " bridge-only", 0, False

echo.
echo KNP Signature auto-start has been installed.
echo From next Windows startup, the print service will start automatically.
echo.
pause
exit /b 0
