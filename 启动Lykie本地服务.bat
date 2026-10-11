@echo off
cd /d "%~dp0"

set "PYEXE=C:\Users\27302\AppData\Local\Programs\Python\Python314\python.exe"

title Lykie Local Server
if not defined LYKIE_PORT set "LYKIE_PORT=5000"

echo ========================================
echo   Lykie Local Server (Restart)
echo   URL: http://127.0.0.1:%LYKIE_PORT%/
echo   Close this window to stop the server
echo ========================================
echo.

if not exist "%PYEXE%" (
  echo [ERROR] python.exe not found at: %PYEXE%
  echo Please edit this .bat and update PYEXE to a valid python.exe path.
  pause
  exit /b 1
)

echo [1/3] Stopping old server on port %LYKIE_PORT% ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_lykie_local.ps1" -Port %LYKIE_PORT% -Root "%~dp0" -KillPortAll
if errorlevel 1 (
  echo [ERROR] Failed to release port %LYKIE_PORT%. Kill the process manually and retry.
  pause
  exit /b 1
)

echo [2/3] Syntax check ...
"%PYEXE%" -m py_compile app.py
if errorlevel 1 (
  echo [ERROR] app.py has syntax errors. Aborted.
  pause
  exit /b 1
)

echo [3/3] Starting from %CD% ...
echo Data dir: %CD%\data
echo.
"%PYEXE%" app.py
if errorlevel 1 (
  echo.
  echo [ERROR] Server exited with error.
  pause
)
