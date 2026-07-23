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
        if (-not $insecure) { Warn "下载失败(可能是自签证书),尝试忽略证书重试 ..." }
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
if (-not $node) { Fail "未检测到 Node.js。请先安装 Node.js 22+: https://nodejs.org/" }
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) { Fail "Node.js 版本过低 ($(node -v),需要 22+): https://nodejs.org/" }
Ok "Node.js $(node -v)"

$tmpDir = Join-Path ([IO.Path]::GetTempPath()) ("nuwa-cli-s3-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

# --- Resolve version ---
if ($pinned) {
    $version = $pinned
    Ok "指定版本: $version"
} else {
    Write-Host "-> 解析 channel '$channel' ..."
    $channelFile = Join-Path $tmpDir "channel.json"
    try { Fetch "$base/channels/$channel.json" $channelFile } catch { Fail "无法读取 channel pointer: $base/channels/$channel.json" }
    $version = (Get-Content $channelFile -Raw | ConvertFrom-Json).version
    if (-not $version) { Fail "channel pointer 无 version 字段。已发布过 $channel 吗?" }
    Ok "channel '$channel' -> $version"
}

# --- Download tarball ---
$pkgName = "@nuwax-ai/nuwa-cli"
# @nuwax-ai/nuwa-cli → nuwax-ai-nuwa-cli (npm pack tarball naming)
$pkgBase = ($pkgName -replace '^@','') -replace '/', '-'
$tarball = "$pkgBase-$version.tgz"
Write-Host "-> 下载 $tarball ..."
$tarballPath = Join-Path $tmpDir $tarball
try { Fetch "$base/versions/$version/artifacts/$tarball" $tarballPath } catch { Fail "tarball 下载失败: $base/versions/$version/artifacts/$tarball" }
Ok "下载完成"

# --- npm install -g <tarball> (deps resolved via npm registry) ---
$registry = $env:NUWACLI_REGISTRY
$installArgs = @("install", "-g", $tarballPath)
if ($registry) { $installArgs += @("--registry", $registry) }
$via = if ($registry) { " via $registry" } else { "" }
Write-Host "-> npm install -g ...$via"
& npm @installArgs
if ($LASTEXITCODE -ne 0) { Fail "npm 安装失败。国内可设镜像重试: `$env:NUWACLI_REGISTRY='https://registry.npmmirror.com'; 再重跑安装命令" }
Ok "安装完成"

# --- PATH check / fix ---
$npmPrefix = (npm config get prefix 2>$null)
if ($npmPrefix) { $npmPrefix = $npmPrefix.Trim() }
if (-not $npmPrefix) { Fail "无法获取 npm 全局目录 (npm config get prefix)。" }
Ok "npm 全局目录: $npmPrefix"

$userPath    = [Environment]::GetEnvironmentVariable("Path", "User")
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$all = New-Object System.Collections.Generic.List[string]
if ($machinePath) { $all.AddRange($machinePath.Split(';')) }
if ($userPath)    { $all.AddRange($userPath.Split(';')) }
$all = $all | Where-Object { $_ -ne '' } | ForEach-Object { $_.TrimEnd('\') }
$prefixNorm = $npmPrefix.TrimEnd('\')

if ($all -contains $prefixNorm) {
    Ok "PATH 已包含 $npmPrefix"
} else {
    Warn "$npmPrefix 不在 PATH 中,正在添加到用户 PATH(无需管理员)..."
    $userEntries = if ($userPath) { $userPath.Split(';') | Where-Object { $_ -ne '' } } else { @() }
    if ($userEntries -contains $prefixNorm) {
        Ok "$npmPrefix 已在用户 PATH(当前窗口未刷新)"
    } else {
        $newPath = if ($userPath) { "$userPath;$npmPrefix" } else { $npmPrefix }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Ok "已添加 $npmPrefix 到用户 PATH"
    }
    $sessionEntries = $env:PATH.Split(';') | ForEach-Object { $_.TrimEnd('\') }
    if ($sessionEntries -notcontains $prefixNorm) { $env:PATH = "$env:PATH;$npmPrefix" }
    Warn "建议重新打开 PowerShell 窗口以确保 PATH 完全生效。"
}

# --- Verify ---
$nuwa = Get-Command nuwa-cli -ErrorAction SilentlyContinue
if ($nuwa) {
    $ver = try { (nuwa-cli --version 2>$null) } catch { "installed" }
    Ok "nuwa-cli 已就绪: $ver"
    Write-Host ""
    Write-Host "安装成功!运行 nuwa-cli -h 查看帮助。" -ForegroundColor Green
} else {
    Warn "nuwa-cli 已安装,但当前会话未识别。请重开 PowerShell 后运行: nuwa-cli -h"
}
