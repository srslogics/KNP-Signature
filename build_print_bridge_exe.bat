@echo off
setlocal
cd /d "%~dp0"

echo Installing build tools...
where py >nul 2>nul
if %errorlevel%==0 (
  set "PY_CMD=py -3"
) else (
  set "PY_CMD=python"
)

%PY_CMD% -m pip install --upgrade pip
%PY_CMD% -m pip install pywin32 pyinstaller

echo Building KNP Signature Print Service.exe ...
%PY_CMD% -m PyInstaller --clean --noconfirm print_bridge.spec

if not exist "%~dp0dist\KNP Signature Print Service.exe" (
  echo.
  echo Build failed. EXE was not created.
  echo Check the messages above and try again.
  echo.
  pause
  exit /b 1
)

echo.
echo Build complete.
echo EXE location:
echo %~dp0dist\KNP Signature Print Service.exe
echo.
pause
exit /b 0
