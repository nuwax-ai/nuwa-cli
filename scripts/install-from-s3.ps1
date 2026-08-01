# nuwa-cli S3 installer (Windows / PowerShell).
# Pulls from the public Nuwax bucket — no credentials, no aws-cli needed.
#
# One-liner:
#   irm https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.ps1 | iex
#
# Pin a channel:        $env:NUWACLI_CHANNEL='beta'
# Pin a version:        $env:NUWACLI_VERSION='0.1.0-beta.3'
# Override npm registry: $env:NUWACLI_REGISTRY='https://registry.npmjs.org'
# Self-signed endpoint: $env:NUWAX_S3_INSECURE='1'
#
# Messages are ASCII English only: Windows PowerShell 5.1 + irm|iex often
# mojibakes UTF-8 CJK in the console.
$ErrorActionPreference = "Stop"

$endpoint = if ($env:NUWAX_S3_ENDPOINT) { $env:NUWAX_S3_ENDPOINT } else { "https://s3.nuwax.com:9443" }
$bucket   = if ($env:NUWAX_S3_BUCKET)   { $env:NUWAX_S3_BUCKET }   else { "nuwax-packages" }
$prefix   = if ($env:NUWAX_S3_PREFIX)   { $env:NUWAX_S3_PREFIX }   else { "agent-engines/nuwa-cli" }
$channel  = if ($env:NUWACLI_CHANNEL)   { $env:NUWACLI_CHANNEL }   else { "beta" }
$pinned   = $env:NUWACLI_VERSION
$insecure = ($env:NUWAX_S3_INSECURE -eq "1")

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
        # ExitCode can be empty/$null when the child PowerShell exits via
        # `exit $LASTEXITCODE` and Windows npm.cmd doesn't propagate a code
        # (npm itself already printed "added N packages" successfully). Treat
        # falsy (null/empty/0) as non-failure; the Get-Command nuwa-cli check
        # later in the script is the source of truth.
        if ($child.ExitCode -and $child.ExitCode -ne 0) {
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

$base = "$endpoint/$bucket/$prefix"

# Public GET; if the endpoint uses a self-signed cert and the user didn't opt
# into -k, retry ignoring the certificate. We never send credentials here.
function Fetch($url, $dest) {
    $ProgressPreference = 'SilentlyContinue'
    $ok = $false
    if (-not $insecure) {
        try { Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing; $ok = $true } catch { }
    }
    if (-not $ok) {
        if (-not $insecure) { Warn "Download failed (self-signed cert?). Retrying with cert check skipped ..." }
        if ($PSVersionTable.PSVersion.Major -ge 6) {
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -SkipCertificateCheck
        } else {
            [System.Net.ServicePointManager]::ServerCertificateValidationCallback = $true
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        }
    }
}

# --- Upgrade detection (was nuwa-cli already installed before install?) ---
$WasInstalled = [bool](Get-Command nuwa-cli -ErrorAction SilentlyContinue)

# --- Node check ---
Step 1 4 "Checking Node.js and resolving the release ..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js not found. Install Node.js 22+: https://nodejs.org/" }
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) { Fail "Node.js too old ($(node -v); need 22+): https://nodejs.org/" }
Ok "Node.js $(node -v)"

$tmpDir = Join-Path ([IO.Path]::GetTempPath()) ("nuwa-cli-s3-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

# --- Resolve version ---
if ($pinned) {
    $version = $pinned
    Ok "Pinned version: $version"
} else {
    Write-Host "-> Resolving channel '$channel' ..."
    $channelFile = Join-Path $tmpDir "channel.json"
    try { Fetch "$base/channels/$channel.json" $channelFile } catch { Fail "Cannot read channel pointer: $base/channels/$channel.json" }
    $version = (Get-Content $channelFile -Raw | ConvertFrom-Json).version
    if (-not $version) { Fail "Channel pointer has no version field. Has $channel been published?" }
    Ok "channel '$channel' -> $version"
}

# --- Skip if already at target version ---
$SkipInstall = $false
if ($WasInstalled) {
    try {
        $installedVersion = (nuwa-cli --version 2>$null).Trim()
        if ($installedVersion -eq $version) {
            Ok "nuwa-cli $version already installed; skipping."
            $SkipInstall = $true
        }
    } catch {}
}

# --- Download tarball ---
if (-not $SkipInstall) {
$pkgName = "@nuwax-ai/nuwa-cli"
# @nuwax-ai/nuwa-cli → nuwax-ai-nuwa-cli (npm pack tarball naming)
$pkgBase = ($pkgName -replace '^@','') -replace '/', '-'
$tarball = "$pkgBase-$version.tgz"
Step 2 4 "Downloading $tarball ..."
$tarballPath = Join-Path $tmpDir $tarball
try { Fetch "$base/versions/$version/artifacts/$tarball" $tarballPath } catch { Fail "Tarball download failed: $base/versions/$version/artifacts/$tarball" }
Ok "Download complete"

# --- Stop running lanproxy (its .exe is locked by a live process and blocks
#     npm's temp-dir cleanup with EPERM on Windows) ---
Get-Process -Name "nuwax-lanproxy" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# --- npm install -g <tarball> (deps resolved via npm registry) ---
$registry = if ($env:NUWACLI_REGISTRY) {
    $env:NUWACLI_REGISTRY
} else {
    "https://registry.npmmirror.com"
}
$installArgs = @("install", "-g", $tarballPath, "--progress=true")
if ($registry) { $installArgs += @("--registry", $registry) }
$via = if ($registry) { " via $registry" } else { "" }
Step 3 4 "Installing nuwa-cli and engine dependencies$via ..."
Write-Host "      Large platform packages are downloaded on first install. npm will show activity below."
try {
    $installElapsed = Invoke-NpmWithProgress $installArgs 55
} catch {
    Fail "npm install failed: $($_.Exception.Message). Check the npm error above. To retry against the official registry: `$env:NUWACLI_REGISTRY='https://registry.npmjs.org'; then re-run the installer"
}
Ok "Dependencies installed in $([math]::Round($installElapsed.TotalSeconds, 1))s"

# --- PATH check / fix ---
Step 4 4 "Configuring PATH and verifying nuwa-cli ..."
$npmPrefix = (npm config get prefix 2>$null)
if ($npmPrefix) { $npmPrefix = $npmPrefix.Trim() }
if (-not $npmPrefix) { Fail "Cannot resolve npm global prefix (npm config get prefix)." }
Ok "npm global prefix: $npmPrefix"

$userPath    = [Environment]::GetEnvironmentVariable("Path", "User")
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$all = New-Object System.Collections.Generic.List[string]
if ($machinePath) { $all.AddRange($machinePath.Split(';')) }
if ($userPath)    { $all.AddRange($userPath.Split(';')) }
$all = $all | Where-Object { $_ -ne '' } | ForEach-Object { $_.TrimEnd('\') }
$prefixNorm = $npmPrefix.TrimEnd('\')

if ($all -contains $prefixNorm) {
    Ok "PATH already contains $npmPrefix"
} else {
    Warn "$npmPrefix is not in PATH; adding to user PATH (no admin required)..."
    $userEntries = if ($userPath) { $userPath.Split(';') | Where-Object { $_ -ne '' } } else { @() }
    if ($userEntries -contains $prefixNorm) {
        Ok "$npmPrefix already in user PATH (current window not refreshed)"
    } else {
        $newPath = if ($userPath) { "$userPath;$npmPrefix" } else { $npmPrefix }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Ok "Added $npmPrefix to user PATH"
    }
    $sessionEntries = $env:PATH.Split(';') | ForEach-Object { $_.TrimEnd('\') }
    if ($sessionEntries -notcontains $prefixNorm) { $env:PATH = "$env:PATH;$npmPrefix" }
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

# --- Post-upgrade serve restart (logged in only) ---
if ($WasInstalled) {
    $credPath = Join-Path $env:USERPROFILE ".nuwa-cli\credentials.json"
    $loggedIn = $false
    if (Test-Path $credPath) {
        try {
            $cred = Get-Content $credPath -Raw | ConvertFrom-Json
            if ($cred.configKey) { $loggedIn = $true }
        } catch {}
    }
    if ($loggedIn) {
        Write-Host "Logged in: restarting nuwa-cli serve in background (post-upgrade)..." -ForegroundColor Cyan
        # serve --daemon is a fire-and-forget launcher: judge success by exit code
        # only. Under ErrorActionPreference=Stop (set at top of script), any
        # native-command stderr — Node DEP0190 shell-spawn warnings, port-change
        # notices — would otherwise throw into the catch and falsely report
        # "restart failed" when the daemon actually launched fine. Relax to
        # Continue for this block only.
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & nuwa-cli stop 2>$null | Out-Null
            Start-Sleep -Seconds 2
            $restartOutput = & nuwa-cli serve --daemon --force 2>&1
            if ($LASTEXITCODE -eq 0) {
                Ok "nuwa-cli serve restarted in background"
            } else {
                Write-Host $restartOutput -ForegroundColor Red
                Warn "serve auto-restart failed (exit $LASTEXITCODE, run manually: nuwa-cli serve --daemon)"
            }
        } catch {
            Warn "serve auto-restart failed: $_ (run manually: nuwa-cli serve --daemon)"
        } finally {
            $ErrorActionPreference = $prevEAP
        }
    } else {
        Write-Host "Not logged in: skipping serve auto-restart." -ForegroundColor Cyan
    }
}
} # end if (-not $SkipInstall)
