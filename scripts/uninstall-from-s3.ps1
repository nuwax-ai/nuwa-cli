# nuwa-cli S3 uninstaller (Windows / PowerShell).
#
# Stops services, removes the scheduled task / startup VBS (if installed),
# npm-uninstalls the global package, and optionally purges $HOME\.nuwa-cli.
#
# One-liner:
#   irm https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/uninstall-from-s3.ps1 | iex
#
# Also purge user data (credentials/sessions/logs):  $env:NUWACLI_PURGE='1'; then re-run.
#
# Messages are ASCII English only: Windows PowerShell 5.1 + irm|iex often
# mojibakes UTF-8 CJK in the console.
$ErrorActionPreference = "Continue"

function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!]  $m" -ForegroundColor Yellow }
function Info($m) { Write-Host "-> $m" -ForegroundColor Cyan }
function Fail($m) { Write-Host "[X]  $m" -ForegroundColor Red; exit 1 }

$pkg = "@nuwax-ai/nuwa-cli"
$taskName = "NuwaCLI"
$label = "com.nuwax.nuwa-cli"
$homeDir = Join-Path $env:USERPROFILE ".nuwa-cli"
$purge = ($env:NUWACLI_PURGE -eq "1")

# --- 1) System service + stop via the CLI (it knows the exact task/vbs/plist names) ---
$nuwa = Get-Command nuwa-cli -ErrorAction SilentlyContinue
if ($nuwa) {
    Info "Removing system service (if installed) and stopping services ..."
    try { & nuwa-cli service uninstall 2>$null | Out-Null } catch {}
    try { & nuwa-cli stop 2>$null | Out-Null } catch {}
}

# --- 2) Kill residual child processes (they hold file locks; fallback when CLI is absent) ---
Info "Stopping residual processes ..."
foreach ($name in @("nuwax-lanproxy", "nuwax-file-server", "mcp-proxy")) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
# serve processes: node.exe running cli.js serve
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'cli\.js.*serve' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

# --- 3) Scheduled task + startup VBS fallback cleanup (when CLI couldn't, or was absent) ---
try { schtasks /End /TN $taskName 2>$null | Out-Null } catch {}
try { schtasks /Delete /TN $taskName /F 2>$null | Out-Null } catch {}
$startupVbs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\nuwa-cli-gateway.vbs"
if (Test-Path $startupVbs) { Remove-Item $startupVbs -Force -ErrorAction SilentlyContinue }

# --- 4) npm uninstall -g via node + npm-cli.js (avoids the PS 5.1 npm.cmd array-splat bug) ---
Info "npm uninstall -g $pkg ..."
$npmArgs = @("uninstall", "-g", $pkg)
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
$npmCli = $null
if ($npmCmd) {
    $candidate = Join-Path (Split-Path $npmCmd.Source) "node_modules\npm\bin\npm-cli.js"
    if (Test-Path $candidate) { $npmCli = $candidate }
}
if ($npmCli) {
    & node $npmCli @npmArgs
} else {
    & npm @npmArgs
}

# --- 5) Verify ---
if (Get-Command nuwa-cli -ErrorAction SilentlyContinue) {
    Fail "Uninstall verification failed: nuwa-cli is still on PATH. The npm uninstall may not have taken effect. Re-run the uninstaller, or manually: npm uninstall -g $pkg"
}
Ok "nuwa-cli uninstalled"

# --- 6) User data (kept by default) ---
if ($purge) {
    Info "NUWACLI_PURGE=1: removing user data $homeDir ..."
    if (Test-Path $homeDir) { Remove-Item $homeDir -Recurse -Force -ErrorAction SilentlyContinue }
    Ok "Removed $homeDir"
} else {
    Warn "User data kept at $homeDir (credentials/sessions/logs). To purge: `$env:NUWACLI_PURGE='1'; re-run, or: Remove-Item -Recurse -Force '$homeDir'"
}

Write-Host ""
Write-Host "Uninstall complete." -ForegroundColor Green
