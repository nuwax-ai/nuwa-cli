# nuwa-cli one-line installer for Windows (PowerShell).
# Usage:  irm https://raw.githubusercontent.com/nuwax-ai/nuwa-cli/main/scripts/install.ps1 | iex
# Runs `npm install -g` and adds the npm global dir to the user PATH so that
# `nuwa-cli` is immediately callable in new terminals (no manual env editing).

$ErrorActionPreference = "Stop"

$Package = "@nuwax-ai/nuwa-cli"
$Tag = if ($env:NUWACLI_TAG) { $env:NUWACLI_TAG } else { "beta" }

function Ok($m)   { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!]  $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[X]  $m" -ForegroundColor Red; exit 1 }

# --- Node/npm check ---
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Fail "未检测到 Node.js。请先安装 Node.js 22+: https://nodejs.org/"
}
$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) {
    Fail "Node.js 版本过低 (当前 $(node -v),需要 22+): https://nodejs.org/"
}
Ok "Node.js $(node -v)"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { Fail "未检测到 npm。请用 Node.js 官方安装器: https://nodejs.org/" }

# --- Install ---
$registry = $env:NUWACLI_REGISTRY
$installArgs = @("install", "-g", "$Package@$Tag")
if ($registry) { $installArgs += @("--registry", $registry) }
$via = if ($registry) { " via $registry" } else { "" }
Write-Host "-> 安装 $Package@$Tag$via ..."
& npm @installArgs
if ($LASTEXITCODE -ne 0) { Fail "npm 安装失败,请检查网络或代理。国内可设镜像重试: `$env:NUWACLI_REGISTRY='https://registry.npmmirror.com'; 再重跑安装命令" }
Ok "安装完成"

# --- Resolve npm global directory ---
$prefix = (npm config get prefix 2>$null)
if ($prefix) { $prefix = $prefix.Trim() }
if (-not $prefix) { Fail "无法获取 npm 全局目录 (npm config get prefix)。" }
Ok "npm 全局目录: $prefix"

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
    Ok "PATH 已包含 $prefix"
} else {
    Warn "$prefix 不在 PATH 中,正在添加到用户 PATH(无需管理员)..."
    $userEntries = if ($userPath) { $userPath.Split(';') | Where-Object { $_ -ne '' } } else { @() }
    if ($userEntries -contains $prefixNorm) {
        Ok "$prefix 已在用户 PATH 中(当前窗口未刷新)"
    } else {
        $newPath = if ($userPath) { "$userPath;$prefix" } else { $prefix }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Ok "已添加 $prefix 到用户 PATH"
    }
    # Best-effort: make it work in this session too.
    $sessionEntries = $env:PATH.Split(';') | ForEach-Object { $_.TrimEnd('\') }
    if ($sessionEntries -notcontains $prefixNorm) {
        $env:PATH = "$env:PATH;$prefix"
    }
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
    Warn "nuwa-cli 已安装,但当前会话未识别。请重新打开 PowerShell 后运行: nuwa-cli -h"
}
