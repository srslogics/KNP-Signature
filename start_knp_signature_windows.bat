@echo off
setlocal
cd /d "%~dp0"

set "EXE_PATH=%~dp0dist\KNP Signature Print Service.exe"
set "PY_SCRIPT=%~dp0print_bridge.py"

call :wait_for_bridge
if not errorlevel 1 goto open_app

call :start_bridge
call :wait_for_bridge

:open_app
start "" "%~dp0frontend\index.html"
exit /b 0

:wait_for_bridge
setlocal
for /l %%i in (1,1,12) do (
  curl -s http://127.0.0.1:9876/health >nul 2>nul
  if not errorlevel 1 (
    endlocal
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)
endlocal
exit /b 1

:start_bridge
if exist "%EXE_PATH%" (
  start "" /min "%EXE_PATH%"
  exit /b 0
)

where pythonw >nul 2>nul
if not errorlevel 1 (
  start "" /min pythonw "%PY_SCRIPT%"
  exit /b 0
)

where py >nul 2>nul
if not errorlevel 1 (
  start "" /min cmd /c py -3 "%PY_SCRIPT%"
  exit /b 0
)

where python >nul 2>nul
if not errorlevel 1 (
  start "" /min python "%PY_SCRIPT%"
  exit /b 0
)

echo Python was not found. Install Python 3 or build the print bridge EXE.
pause
exit /b 1
