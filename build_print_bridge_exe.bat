@echo off
setlocal
cd /d "%~dp0"

echo Installing build tools...
python -m pip install --upgrade pip
python -m pip install pywin32 pyinstaller

echo Building KNP Signature Print Service.exe ...
pyinstaller --clean --noconfirm print_bridge.spec

echo.
echo Build complete.
echo EXE location:
echo %~dp0dist\KNP Signature Print Service.exe
echo.
pause
exit /b 0
