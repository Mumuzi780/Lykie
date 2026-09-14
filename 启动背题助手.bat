@echo off
chcp 65001 >nul
cd /d "%~dp0"

title 背题助手 + Lykie
if not defined LYKIE_PORT set "LYKIE_PORT=5000"

echo ========================================
echo   背题助手（Flask）
echo   地址: http://127.0.0.1:%LYKIE_PORT%/
echo   首次请先创建: python add_user.py 用户名
echo   关闭本窗口即停止服务
echo ========================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 python，请先安装并加入 PATH。
  pause
  exit /b 1
)

REM 启动前先清掉同端口 / 本目录残留，避免多开导致旧代码仍在响应
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_lykie_local.ps1" -Port %LYKIE_PORT% -Root "%~dp0" >nul

python -m py_compile app.py
if errorlevel 1 (
  echo [错误] app.py 有语法错误，已中止启动。
  pause
  exit /b 1
)

python app.py
if errorlevel 1 (
  echo.
  echo [错误] 启动失败。
  pause
)
