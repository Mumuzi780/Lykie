# Stop local Lykie dev server: free the port (optionally any python on it)
# and kill any repo app.py stragglers, regardless of where they were started.
# NOTE: keep this file ASCII-only. PowerShell 5 reads .ps1 without BOM as GBK.
param(
  [int]$Port = 5000,
  [string]$Root = "",
  [switch]$KillPortAll
)

$ErrorActionPreference = "SilentlyContinue"

if (-not $Root) {
  $Root = Split-Path -Parent $PSScriptRoot
}
$Root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd("\")

# 1) Kill listeners on the port.
#    -KillPortAll: kill whatever python holds the port, even if started
#    from another directory (the "ghost server, empty data" failure mode).
#    Without it, only python listeners are killed; other processes are skipped.
$connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
foreach ($c in $connections) {
  $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  if (-not $proc) { continue }
  $isPython = $proc.ProcessName -in @("python", "pythonw")
  if ($KillPortAll -or $isPython) {
    Write-Host ("  kill port-{0} PID {1} ({2})" -f $Port, $proc.Id, $proc.ProcessName)
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host ("  [skip] port {0} held by non-python PID {1} ({2})" -f $Port, $proc.Id, $proc.ProcessName)
  }
}

# 2) Kill any app.py process whose command line references this repo.
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
  Write-Host ("[WARN] port still held by PID: " + $pids)
  exit 2
}

Write-Host "  port released."
exit 0
