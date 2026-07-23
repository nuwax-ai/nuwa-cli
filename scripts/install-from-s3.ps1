# nuwa-cli S3 installer (Windows / PowerShell).
# Pulls from the public Nuwax bucket — no credentials, no aws-cli needed.
#
# One-liner:
#   irm https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.ps1 | iex
#
# Pin a channel:        $env:NUWACLI_CHANNEL='beta'
# Pin a version:        $env:NUWACLI_VERSION='0.1.0-beta.3'
# Use an npm mirror:    $env:NUWACLI_REGISTRY='https://registry.npmmirror.com'
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

# --- Node check ---
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

# --- Download tarball ---
$pkgName = "@nuwax-ai/nuwa-cli"
# @nuwax-ai/nuwa-cli → nuwax-ai-nuwa-cli (npm pack tarball naming)
$pkgBase = ($pkgName -replace '^@','') -replace '/', '-'
$tarball = "$pkgBase-$version.tgz"
Write-Host "-> Downloading $tarball ..."
$tarballPath = Join-Path $tmpDir $tarball
try { Fetch "$base/versions/$version/artifacts/$tarball" $tarballPath } catch { Fail "Tarball download failed: $base/versions/$version/artifacts/$tarball" }
Ok "Download complete"

# --- npm install -g <tarball> (deps resolved via npm registry) ---
$registry = $env:NUWACLI_REGISTRY
$installArgs = @("install", "-g", $tarballPath)
if ($registry) { $installArgs += @("--registry", $registry) }
$via = if ($registry) { " via $registry" } else { "" }
Write-Host "-> npm install -g ...$via"
& npm @installArgs
if ($LASTEXITCODE -ne 0) { Fail "npm install failed. For China mirrors retry with: `$env:NUWACLI_REGISTRY='https://registry.npmmirror.com'; then re-run the installer" }
Ok "Install complete"

# --- PATH check / fix ---
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
