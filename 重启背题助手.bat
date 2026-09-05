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
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$port = [int]$env:LYKIE_PORT; $root = (Resolve-Path -LiteralPath '%~dp0').Path.TrimEnd('\');" ^
  "Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {" ^
  "  Write-Host ('  kill listen PID ' + $_.OwningProcess);" ^
  "  Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue" ^
  "};" ^
  "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |" ^
  "  Where-Object {" ^
  "    ($_.Name -eq 'python.exe' -or $_.Name -eq 'pythonw.exe') -and" ^
  "    $_.CommandLine -and" ^
  "    ($_.CommandLine -like ('*' + $root + '*')) -and" ^
  "    ($_.CommandLine -match 'app\.py')" ^
  "  } | ForEach-Object {" ^
  "    Write-Host ('  kill app.py PID ' + $_.ProcessId);" ^
  "    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue" ^
  "};" ^
  "Start-Sleep -Seconds 1;" ^
  "$left = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue);" ^
  "if ($left.Count -gt 0) { Write-Host ('[警告] 端口仍被占用 PID: ' + (($left | Select-Object -ExpandProperty OwningProcess) -join ', ')); exit 2 }"

if errorlevel 2 (
  echo [错误] 无法释放端口 %LYKIE_PORT%，请手动结束占用进程后再试。
  pause
  exit /b 1
)

echo [2/2] 启动 python app.py ...
echo 关闭本窗口即停止服务。
echo.
python app.py
if errorlevel 1 (
  echo.
  echo [错误] 启动失败。
  pause
)
