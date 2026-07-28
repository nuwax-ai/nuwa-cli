# nuwa-cli one-line installer for Windows (PowerShell).
# Usage:  irm https://raw.githubusercontent.com/nuwax-ai/nuwa-cli/main/scripts/install.ps1 | iex
# Runs `npm install -g` and adds the npm global dir to the user PATH so that
# `nuwa-cli` is immediately callable in new terminals (no manual env editing).
#
# Messages are ASCII English only: Windows PowerShell 5.1 + irm|iex often
# mojibakes UTF-8 CJK in the console.

$ErrorActionPreference = "Stop"

$Package = "@nuwax-ai/nuwa-cli"
$Tag = if ($env:NUWACLI_TAG) { $env:NUWACLI_TAG } else { "beta" }

function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!]  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[X]  $m" -ForegroundColor Red; exit 1 }
function Step($n, $total, $m) { Write-Host "[$n/$total] $m" -ForegroundColor Cyan }

function Invoke-NpmWithProgress($NpmArgs, $StartPercent) {
    # Run npm in a child PowerShell process. Start-Job is intentionally avoided:
    # Windows PowerShell 5.1 can lose the argument array/job environment and
    # Receive-Job may hide the original npm stderr under ErrorActionPreference=Stop.
    $argsJson = ConvertTo-Json -InputObject @($NpmArgs) -Compress
    $argsBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($argsJson))
    $childScript = '$ErrorActionPreference = "Stop"; $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' +
        $argsBase64 +
        '")); $npmArgs = @(ConvertFrom-Json $json); & npm @npmArgs; exit $LASTEXITCODE'
    $encodedCommand = [Convert]::ToBase64String(
        [Text.Encoding]::Unicode.GetBytes($childScript)
    )
    $powershellExe = (Get-Process -Id $PID).Path
    $stdoutLog = [IO.Path]::GetTempFileName()
    $stderrLog = [IO.Path]::GetTempFileName()
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $child = Start-Process -FilePath $powershellExe `
            -ArgumentList @("-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", $encodedCommand) `
            -NoNewWindow -PassThru `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog

        while (-not $child.HasExited) {
            $elapsed = [math]::Floor($watch.Elapsed.TotalSeconds)
            $percent = $StartPercent + [math]::Floor(
                (95 - $StartPercent) * $elapsed / ($elapsed + 20)
            )
            Write-Progress -Activity "Installing nuwa-cli" `
                -Status "Downloading and installing dependencies (estimated) - $percent%" `
                -PercentComplete $percent
            Start-Sleep -Milliseconds 500
        }
        $child.WaitForExit()
        $watch.Stop()
        Write-Progress -Activity "Installing nuwa-cli" -Completed

        $stdout = if (Test-Path $stdoutLog) { Get-Content $stdoutLog -Raw } else { "" }
        $stderr = if (Test-Path $stderrLog) { Get-Content $stderrLog -Raw } else { "" }
        if ($child.ExitCode -ne 0) {
            if ($stdout.Trim()) { Write-Host $stdout.TrimEnd() }
            if ($stderr.Trim()) { Write-Host $stderr.TrimEnd() -ForegroundColor Red }
            throw "npm exited with code $($child.ExitCode)"
        }
        if ($stdout.Trim()) { Write-Host $stdout.TrimEnd() }
        if ($stderr.Trim()) { Write-Host $stderr.TrimEnd() -ForegroundColor Yellow }
        Write-Host "[##############################] 100% Dependencies installed" -ForegroundColor Green
        return $watch.Elapsed
    } finally {
        Write-Progress -Activity "Installing nuwa-cli" -Completed
        Remove-Item $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue
    }
}

# --- Node/npm check ---
Step 1 3 "Checking Node.js and npm ..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Fail "Node.js not found. Install Node.js 22+: https://nodejs.org/"
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) {
    Fail "Node.js too old (current $(node -v); need 22+): https://nodejs.org/"
}
Ok "Node.js $(node -v)"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Fail "npm not found. Use the official Node.js installer: https://nodejs.org/" }

# --- Install ---
$registry = $env:NUWACLI_REGISTRY
$installArgs = @("install", "-g", "$Package@$Tag", "--progress=true")
if ($registry) { $installArgs += @("--registry", $registry) }
$via = if ($registry) { " via $registry" } else { "" }
Step 2 3 "Installing $Package@$Tag$via ..."
Write-Host "      Downloading and unpacking engine dependencies. The first install can take several minutes."
try {
    $installElapsed = Invoke-NpmWithProgress $installArgs 35
} catch {
    Fail "npm install failed: $($_.Exception.Message). Check the npm error above. For China mirrors retry with: `$env:NUWACLI_REGISTRY='https://registry.npmmirror.com'; then re-run the installer"
}
Ok "Dependencies installed in $([math]::Round($installElapsed.TotalSeconds, 1))s"

# --- Resolve npm global directory ---
Step 3 3 "Configuring PATH and verifying nuwa-cli ..."
$prefix = (npm config get prefix 2>$null)
if ($prefix) { $prefix = $prefix.Trim() }
if (-not $prefix) { Fail "Cannot resolve npm global prefix (npm config get prefix)." }
Ok "npm global prefix: $prefix"

# --- PATH check / fix ---
# Read both Machine and User PATH to decide whether the dir is already known.
$userPath     = [Environment]::GetEnvironmentVariable("Path", "User")
$machinePath  = [Environment]::GetEnvironmentVariable("Path", "Machine")
$allEntries = New-Object System.Collections.Generic.List[string]
if ($machinePath) { $allEntries.AddRange($machinePath.Split(';')) }
if ($userPath)    { $allEntries.AddRange($userPath.Split(';')) }
$allEntries = $allEntries | Where-Object { $_ -ne '' } | ForEach-Object { $_.TrimEnd('\') }
$prefixNorm = $prefix.TrimEnd('\')

if ($allEntries -contains $prefixNorm) {
    Ok "PATH already contains $prefix"
} else {
    Warn "$prefix is not in PATH; adding to user PATH (no admin required)..."
    $userEntries = if ($userPath) { $userPath.Split(';') | Where-Object { $_ -ne '' } } else { @() }
    if ($userEntries -contains $prefixNorm) {
        Ok "$prefix already in user PATH (current window not refreshed)"
    } else {
        $newPath = if ($userPath) { "$userPath;$prefix" } else { $prefix }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Ok "Added $prefix to user PATH"
    }
    # Best-effort: make it work in this session too.
    $sessionEntries = $env:PATH.Split(';') | ForEach-Object { $_.TrimEnd('\') }
    if ($sessionEntries -notcontains $prefixNorm) {
        $env:PATH = "$env:PATH;$prefix"
    }
    Warn "Reopen PowerShell so PATH changes take full effect."
}

# --- Verify ---
$nuwa = Get-Command nuwa-cli -ErrorAction SilentlyContinue
if ($nuwa) {
    $ver = try { (nuwa-cli --version 2>$null) } catch { "installed" }
    Ok "nuwa-cli ready: $ver"
    Write-Host ""
    Write-Host "Install succeeded. Run nuwa-cli -h for help." -ForegroundColor Green
} else {
    Warn "nuwa-cli is installed but not visible in this session. Reopen PowerShell and run: nuwa-cli -h"
}
