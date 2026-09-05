@echo off
cd /d "%~dp0story-editor"

title 剧情分支编辑器
echo ========================================
echo   剧情分支编辑器（Vite）
echo   地址: http://127.0.0.1:5173/
echo   关闭本窗口即停止服务
echo ========================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 npm，请先安装 Node.js。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo 首次运行，正在 npm install …
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败。
    pause
    exit /b 1
  )
  echo.
)

call npm run dev -- --open
if errorlevel 1 (
  echo.
  echo [错误] 启动失败。
  pause
)
