# Stop local Lykie Flask (port + this-repo app.py)
param(
  [int]$Port = 5000,
  [string]$Root = ""
)

$ErrorActionPreference = "SilentlyContinue"

if (-not $Root) {
  $Root = Split-Path -Parent $PSScriptRoot
}
$Root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd("\")

Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object {
    Write-Host ("  kill listen PID " + $_.OwningProcess)
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    ($_.Name -eq "python.exe" -or $_.Name -eq "pythonw.exe") -and
    $_.CommandLine -and
    ($_.CommandLine -like ("*" + $Root + "*")) -and
    ($_.CommandLine -match "app\.py")
  } |
  ForEach-Object {
    Write-Host ("  kill app.py PID " + $_.ProcessId)
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Start-Sleep -Seconds 1

$left = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($left.Count -gt 0) {
  $pids = ($left | Select-Object -ExpandProperty OwningProcess) -join ", "
  Write-Host ("[警告] 端口仍被占用 PID: " + $pids)
  exit 2
}

exit 0
