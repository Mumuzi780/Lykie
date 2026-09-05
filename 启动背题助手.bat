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
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = [int]$env:LYKIE_PORT; $root = (Resolve-Path -LiteralPath '%~dp0').Path.TrimEnd('\');" ^
  "Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {" ^
  "  Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue" ^
  "};" ^
  "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |" ^
  "  Where-Object {" ^
  "    ($_.Name -eq 'python.exe' -or $_.Name -eq 'pythonw.exe') -and" ^
  "    $_.CommandLine -and" ^
  "    ($_.CommandLine -like ('*' + $root + '*')) -and" ^
  "    ($_.CommandLine -match 'app\.py')" ^
  "  } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "Start-Sleep -Seconds 1" >nul

python app.py
if errorlevel 1 (
  echo.
  echo [错误] 启动失败。
  pause
)
