@echo off
setlocal
cd /d "%~dp0"

set "PY_SCRIPT=%~dp0print_bridge.py"
set "LAUNCH_MODE=%~1"
set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python312\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python313\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python311\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE="

call :wait_for_bridge
if not errorlevel 1 goto maybe_open_app

call :start_bridge
call :wait_for_bridge

:maybe_open_app
if /I "%LAUNCH_MODE%"=="bridge-only" exit /b 0
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
if defined PYTHON_EXE (
  start "KNP Bridge" /min cmd /c ""%PYTHON_EXE%" "%PY_SCRIPT%""
  exit /b 0
)

where py >nul 2>nul
if not errorlevel 1 (
  start "KNP Bridge" /min cmd /c py -3 "%PY_SCRIPT%"
  exit /b 0
)

where python >nul 2>nul
if not errorlevel 1 (
  start "KNP Bridge" /min cmd /c python "%PY_SCRIPT%"
  exit /b 0
)

echo Python was not found. Install Python 3 or build the print bridge EXE.
pause
exit /b 1
