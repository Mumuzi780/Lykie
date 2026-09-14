@echo off
chcp 65001 >nul
cd /d "%~dp0"

title Lykie 重启
if not defined LYKIE_PORT set "LYKIE_PORT=5000"

echo ========================================
echo   重启背题助手
echo   地址: http://127.0.0.1:%LYKIE_PORT%/
echo ========================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 python，请先安装并加入 PATH。
  pause
  exit /b 1
)

echo [1/2] 清理端口 %LYKIE_PORT% 与本目录残留的 app.py ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_lykie_local.ps1" -Port %LYKIE_PORT% -Root "%~dp0"
if errorlevel 1 (
  echo [错误] 无法释放端口 %LYKIE_PORT%，请手动结束占用进程后再试。
  pause
  exit /b 1
)

echo [2/2] 语法检查 ...
python -m py_compile app.py
if errorlevel 1 (
  echo [错误] app.py 有语法错误，已中止启动。
  pause
  exit /b 1
)

echo [3/3] 启动 python app.py ...
echo 关闭本窗口即停止服务。
echo.
python app.py
if errorlevel 1 (
  echo.
  echo [错误] 启动失败。
  pause
)
