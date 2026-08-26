# nuwa-cli S3 installer (Windows / PowerShell).
# Pulls from the public Nuwax bucket — no credentials, no aws-cli needed.
#
# Product split (align with `nuwa-cli install` / `nuwa-cli update`):
#   - Not installed → download tarball → npm i -g → PATH →
#       `nuwa-cli install --yes --bootstrap` (silent login/start)
#   - Installed, different version → `nuwa-cli update <VERSION> --yes`
#       (update kernel: stop/locks/incremental + logged-in restart)
#   - Same version → skip (no restart, no bootstrap)
#
# One-liner:
#   irm https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.ps1 | iex
#
# Pin a channel:        $env:NUWACLI_CHANNEL='stable' (default) / 'beta'
# Pin a version:        $env:NUWACLI_VERSION='0.2.0'
# Override npm registry: $env:NUWACLI_REGISTRY='https://registry.npmjs.org'
# Self-signed endpoint: $env:NUWAX_S3_INSECURE='1'
# Skip bootstrap start: $env:NUWACLI_NO_START='1'
#
# Messages are ASCII English only: Windows PowerShell 5.1 + irm|iex often
# mojibakes UTF-8 CJK in the console. When we MUST print UTF-8 from nuwa-cli,
# use Invoke-NativeUtf8 so capture/decoding matches.
$ErrorActionPreference = "Stop"

$endpoint = if ($env:NUWAX_S3_ENDPOINT) { $env:NUWAX_S3_ENDPOINT } else { "https://s3.nuwax.com:9443" }
$bucket   = if ($env:NUWAX_S3_BUCKET)   { $env:NUWAX_S3_BUCKET }   else { "nuwax-packages" }
$prefix   = if ($env:NUWAX_S3_PREFIX)   { $env:NUWAX_S3_PREFIX }   else { "agent-engines/nuwa-cli" }
$channel  = if ($env:NUWACLI_CHANNEL)   { $env:NUWACLI_CHANNEL }   else { "stable" }
$pinned   = $env:NUWACLI_VERSION
$insecure = ($env:NUWAX_S3_INSECURE -eq "1")
$noStart  = ($env:NUWACLI_NO_START -eq "1")

function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!]  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[X]  $m" -ForegroundColor Red; exit 1 }
function Step($n, $total, $m) { Write-Host "[$n/$total] $m" -ForegroundColor Cyan }

# PowerShell 默认用 OEM/ANSI（中文 Windows 常为 CP936）解码外部进程 stdout。
# Node/nuwa-cli 写 UTF-8；捕获进变量时会把中文解成乱码。临时切 UTF-8 再跑。
function Invoke-NativeUtf8([scriptblock]$Script) {
    $prevOut = [Console]::OutputEncoding
    $prevIn  = [Console]::InputEncoding
    $prevOE  = $OutputEncoding
    try {
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [Console]::OutputEncoding = $utf8
        [Console]::InputEncoding  = $utf8
        $script:OutputEncoding    = $utf8
        & $Script
    } finally {
        [Console]::OutputEncoding = $prevOut
        [Console]::InputEncoding  = $prevIn
        $script:OutputEncoding    = $prevOE
    }
}

# picocolors 写入的 ANSI 在非 VT 控制台会显示成 [22m/[39m 残渣；剥离后再打印。
function Format-CliCapture($Captured) {
    $text = ($Captured | Out-String)
    $text = [regex]::Replace($text, '\x1B\[[0-9;]*m', '')
    $text = [regex]::Replace($text, '\[(?:\d{1,3};)*\d{1,3}m', '')
    return $text.TrimEnd()
}

# Resolve absolute path to nuwa-cli.cmd for this session (PATH may lag User PATH).
function Resolve-NuwaCli {
    $cmd = Get-Command nuwa-cli -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
    $npmPrefix = (npm config get prefix 2>$null)
    if ($npmPrefix) { $npmPrefix = $npmPrefix.Trim() }
    if (-not $npmPrefix) { return $null }
    foreach ($candidate in @(
        (Join-Path $npmPrefix "nuwa-cli.cmd"),
        (Join-Path $npmPrefix "nuwa-cli"),
        (Join-Path $npmPrefix "bin\nuwa-cli.cmd"),
        (Join-Path $npmPrefix "bin\nuwa-cli")
    )) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Invoke-NpmWithProgress($NpmArgs, $StartPercent) {
    # Run npm in a child PowerShell process. Start-Job is intentionally avoided:
    # Windows PowerShell 5.1 can lose the argument array/job environment and
    # Receive-Job may hide the original npm stderr under ErrorActionPreference=Stop.
    $argsJson = ConvertTo-Json -InputObject @($NpmArgs) -Compress
    $argsBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($argsJson))
    $childScript = '$ErrorActionPreference = "Stop"; $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' +
        $argsBase64 +
        '")); $npmArgs = @(ConvertFrom-Json $json); $npmCli = $null; $npmCmd = Get-Command npm -ErrorAction SilentlyContinue; if ($npmCmd) { $candidate = Join-Path (Split-Path $npmCmd.Source) "node_modules\npm\bin\npm-cli.js"; if (Test-Path $candidate) { $npmCli = $candidate } }; if ($npmCli) { & node $npmCli @npmArgs } else { & npm @npmArgs }; exit $LASTEXITCODE'
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

        $stdout = if (Test-Path $stdoutLog) { Get-Content $stdoutLog -Raw -ErrorAction SilentlyContinue } else { $null }
        $stderr = if (Test-Path $stderrLog) { Get-Content $stderrLog -Raw -ErrorAction SilentlyContinue } else { $null }
        if ($null -eq $stdout) { $stdout = "" }
        if ($null -eq $stderr) { $stderr = "" }
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

# --- Node check ---
Step 1 4 "Checking Node.js and resolving the release ..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js not found. Install Node.js 22+: https://nodejs.org/" }
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) { Fail "Node.js too old ($(node -v); need 22+): https://nodejs.org/" }
Ok "Node.js $(node -v)"

# --- Detect whether nuwa-cli is already globally installed (not just visible on PATH) ---
$nuwaBinPre = Resolve-NuwaCli
$WasInstalled = [bool]$nuwaBinPre

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

# --- Same version: skip entirely (no restart, no bootstrap) ---
if ($WasInstalled) {
    try {
        $installedVersion = (& $nuwaBinPre --version 2>$null).Trim()
        if ($installedVersion -eq $version) {
            Ok "nuwa-cli $version already installed; skipping."
            Write-Host "-> Prefer daily upgrades via: nuwa-cli update" -ForegroundColor Cyan
            Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
            return
        }
    } catch {}
}

# --- Upgrade path: already installed, different version → update kernel ---
if ($WasInstalled) {
    $nuwaBin = $nuwaBinPre
    Step 2 2 "Already installed -> nuwa-cli update $version --yes ..."
    Write-Host "-> Upgrade uses the update kernel (stop / Windows locks / incremental). Do not bare npm i -g." -ForegroundColor Cyan
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $updateOutput = Invoke-NativeUtf8 { & $nuwaBin update $version --yes 2>&1 }
        $formatted = Format-CliCapture $updateOutput
        if ($formatted) { Write-Host $formatted }
        if ($LASTEXITCODE -ne 0) {
            Fail "nuwa-cli update failed (exit $LASTEXITCODE). Retry: nuwa-cli update $version --yes"
        }
        Ok "Upgrade complete (update restarts Gateway when logged in)"
        $credPath = Join-Path $env:USERPROFILE ".nuwa-cli\credentials.json"
        $loggedIn = $false
        if (Test-Path $credPath) {
            try {
                $cred = Get-Content $credPath -Raw | ConvertFrom-Json
                if ($cred.configKey) { $loggedIn = $true }
            } catch {}
        }
        # Logged-in restart is owned by update — do not call install --bootstrap.
        if (-not $loggedIn -and -not $noStart) {
            Write-Host "-> Not logged in: silent bootstrap hint (no auto start)..." -ForegroundColor Cyan
            $bootOutput = Invoke-NativeUtf8 { & $nuwaBin install --yes --bootstrap 2>&1 }
            $bootText = Format-CliCapture $bootOutput
            if ($bootText) { Write-Host $bootText }
        }
    } finally {
        $ErrorActionPreference = $prevEAP
        Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    return
}

# --- New install: download tarball → npm i -g → PATH → install --bootstrap ---
$pkgName = "@nuwax-ai/nuwa-cli"
$pkgBase = ($pkgName -replace '^@','') -replace '/', '-'
$tarball = "$pkgBase-$version.tgz"
Step 2 4 "Downloading $tarball ..."
$tarballPath = Join-Path $tmpDir $tarball
try { Fetch "$base/versions/$version/artifacts/$tarball" $tarballPath } catch { Fail "Tarball download failed: $base/versions/$version/artifacts/$tarball" }
Ok "Download complete"

# Release vendor .exe locks if any leftover processes hold them (usually none on first install).
$vendorImages = @("nuwax-codex.exe", "nuwax-lanproxy.exe")
$stuck = @()
for ($attempt = 1; $attempt -le 3; $attempt++) {
    foreach ($image in $vendorImages) {
        & taskkill /F /IM $image 2>$null | Out-Null
    }
    Start-Sleep -Seconds 1
    $stuck = @()
    foreach ($image in $vendorImages) {
        $procName = $image -replace '\.exe$', ''
        if (Get-Process -Name $procName -ErrorAction SilentlyContinue) {
            $stuck += $image
        }
    }
    if ($stuck.Count -eq 0) { break }
}
if ($stuck.Count -gt 0) {
    Fail "Cannot install while $($stuck -join ', ') is still running. Run: taskkill /F /IM nuwax-lanproxy.exe ; taskkill /F /IM nuwax-codex.exe ; then retry."
}

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
    Fail "npm install failed: $($_.Exception.Message). If you saw EBUSY / resource busy or locked, stop services first or use nuwa-cli update. To retry against the official registry: `$env:NUWACLI_REGISTRY='https://registry.npmjs.org'; then re-run the installer"
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

$nuwaBin = Resolve-NuwaCli
if (-not $nuwaBin) {
    Fail "nuwa-cli is installed but not visible in this session. Reopen PowerShell and run: nuwa-cli -h"
}
$ver = try { (& $nuwaBin --version 2>$null).Trim() } catch { "" }
if (-not $ver) {
    Fail "Install verification failed: nuwa-cli is present but --version returned nothing. Re-run the installer, or: npm i -g @nuwax-ai/nuwa-cli@$channel"
} elseif ($ver -ne $version) {
    Fail "Install verification failed: expected nuwa-cli $version but found $ver. Re-run the installer, or: npm i -g @nuwax-ai/nuwa-cli@$channel"
}
Ok "nuwa-cli ready: $ver"
Write-Host ""
Write-Host "Install succeeded." -ForegroundColor Green

Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue

if ($noStart) {
    Write-Host "-> NUWACLI_NO_START=1: skipping login/start. Next: nuwa-cli login ; nuwa-cli start" -ForegroundColor Cyan
    return
}

Write-Host "-> Continuing silent bootstrap: install --yes --bootstrap ..." -ForegroundColor Cyan
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $bootOutput = Invoke-NativeUtf8 { & $nuwaBin install --yes --bootstrap 2>&1 }
    $formatted = Format-CliCapture $bootOutput
    if ($formatted) { Write-Host $formatted }
    if ($LASTEXITCODE -ne 0) {
        Warn "bootstrap did not finish (exit $LASTEXITCODE). If not logged in, run: nuwa-cli login ; nuwa-cli start"
    }
} finally {
    $ErrorActionPreference = $prevEAP
}
