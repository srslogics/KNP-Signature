@echo off
setlocal
cd /d "%~dp0"

set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET_BAT=%~dp0start_knp_signature_windows.bat"
set "STARTUP_SHORTCUT=%STARTUP_DIR%\KNP Signature Print Bridge.lnk"

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

powershell -NoProfile -ExecutionPolicy Bypass -Command "$shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut('%STARTUP_SHORTCUT%'); $shortcut.TargetPath = '%TARGET_BAT%'; $shortcut.Arguments = 'bridge-only'; $shortcut.WorkingDirectory = '%~dp0'; $shortcut.WindowStyle = 7; $shortcut.Save()"
if errorlevel 1 (
  echo Unable to create the Windows Startup shortcut.
  pause
  exit /b 1
)

if exist "%STARTUP_DIR%\KNP Signature.vbs" del /q "%STARTUP_DIR%\KNP Signature.vbs"

echo.
echo KNP Signature auto-start has been installed.
echo From next Windows sign-in, the print service will start automatically.
echo.
pause
exit /b 0
