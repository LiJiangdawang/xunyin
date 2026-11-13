# =============================================================
# 一键把寻音推到 GitHub 并编译出 IPA
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\github-build.ps1 `
#       -Token ghp_xxxxxxxx `
#       -User 你的GitHub用户名 `
#       -Repo xunyin
#
# Token 权限（Fine-grained）：
#   Repository access  : All repositories（或指定）
#   Contents           : Read and write
#   Workflows          : Read and write
#   Actions            : Read and write
#   Administration     : Read and write（仅用于自动建仓库；已有仓库则不需要）
# =============================================================
param(
    [Parameter(Mandatory = $true)][string]$Token,
    [Parameter(Mandatory = $true)][string]$User,
    [string]$Repo = "xunyin",
    [string]$ProjectDir = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = 'Stop'
$api = "https://api.github.com"
$headers = @{
    Authorization          = "Bearer $Token"
    Accept                 = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent"           = "xunyin-build"
}

function Step($m) { Write-Host "`n>>> $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "    $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    $m" -ForegroundColor Yellow }

# ---------- 0. 校验 token ----------
Step '校验 GitHub 账号'
try {
    $me = Invoke-RestMethod -Uri "$api/user" -Headers $headers -TimeoutSec 20
    Ok ("登录成功: " + $me.login)
    if ($me.login -ne $User) { Warn ("注意：token 属于 $($me.login)，不是 $User") }
} catch {
    Write-Host "    token 无效或权限不足: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# ---------- 1. 创建仓库（已存在则跳过）----------
Step "准备仓库 $User/$Repo"
$repoExists = $false
try {
    $null = Invoke-RestMethod -Uri "$api/repos/$User/$Repo" -Headers $headers -TimeoutSec 20
    $repoExists = $true
    Ok '仓库已存在，直接使用'
} catch {
    Warn '仓库不存在，尝试创建…'
}

if (-not $repoExists) {
    try {
        $body = @{ name = $Repo; private = $false; description = '寻音 XunYin - 全离线音乐播放器'; auto_init = $false } | ConvertTo-Json
        $null = Invoke-RestMethod -Uri "$api/user/repos" -Method Post -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 30
        Ok "已创建公开仓库: https://github.com/$User/$Repo"
    } catch {
        Write-Host "    创建失败: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "    请先在网页上手动建一个空仓库，再重跑本脚本。" -ForegroundColor Yellow
        exit 1
    }
}

# ---------- 2. 推送代码 ----------
Step '推送代码'
Push-Location $ProjectDir
try {
    $remoteUrl = "https://$User`:$Token@github.com/$User/$Repo.git"
    $existing = git remote 2>$null
    if ($existing -contains 'origin') {
        git remote set-url origin $remoteUrl
    } else {
        git remote add origin $remoteUrl
    }

    $branch = git branch --show-current
    if (-not $branch) { $branch = 'main' }

    Write-Host "    推送到分支: $branch"
    $pushOut = git push -u origin $branch --force 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Host $pushOut -ForegroundColor Red
        throw '推送失败'
    }
    Ok '推送完成'
} finally {
    Pop-Location
}

# ---------- 3. 触发 workflow ----------
Step '触发 iOS 构建'
Start-Sleep -Seconds 3
try {
    $body = @{ ref = $branch } | ConvertTo-Json
    $null = Invoke-RestMethod -Uri "$api/repos/$User/$Repo/actions/workflows/ios.yml/dispatches" `
        -Method Post -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 30
    Ok 'workflow 已触发'
} catch {
    Warn "触发失败（可能 push 已自动触发）: $($_.Exception.Message)"
}

# ---------- 4. 等待构建 ----------
Step '等待构建完成（最长 25 分钟）'
$runId = $null
$deadline = (Get-Date).AddMinutes(25)
$lastStatus = ''

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 15
    try {
        $runs = Invoke-RestMethod -Uri "$api/repos/$User/$Repo/actions/runs?per_page=5" -Headers $headers -TimeoutSec 20
        $run = $runs.workflow_runs | Where-Object { $_.name -like '*iOS*' } | Select-Object -First 1
        if (-not $run) { continue }
        $runId = $run.id
        $st = "$($run.status)/$($run.conclusion)"
        if ($st -ne $lastStatus) {
            Write-Host ("    " + (Get-Date -Format 'HH:mm:ss') + "  " + $st)
            $lastStatus = $st
        }
        if ($run.status -eq 'completed') { break }
    } catch {
        Warn "查询状态出错: $($_.Exception.Message)"
    }
}

if (-not $runId) { Write-Host '    没有找到构建记录' -ForegroundColor Red; exit 1 }

$final = Invoke-RestMethod -Uri "$api/repos/$User/$Repo/actions/runs/$runId" -Headers $headers
if ($final.conclusion -ne 'success') {
    Write-Host "`n构建失败：$($final.conclusion)" -ForegroundColor Red
    Write-Host "查看日志: $($final.html_url)" -ForegroundColor Yellow
    exit 1
}
Ok "构建成功: $($final.html_url)"

# ---------- 5. 下载 IPA ----------
Step '下载 IPA'
$arts = Invoke-RestMethod -Uri "$api/repos/$User/$Repo/actions/runs/$runId/artifacts" -Headers $headers
$ipaArt = $arts.artifacts | Where-Object { $_.name -eq 'xunyin-ios-ipa' } | Select-Object -First 1
if (-not $ipaArt) {
    Write-Host '    没找到 IPA 产物' -ForegroundColor Red
    $arts.artifacts | ForEach-Object { Write-Host ("    可用产物: " + $_.name) }
    exit 1
}

$outDir = Join-Path $ProjectDir 'dist'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipPath = Join-Path $outDir 'xunyin-ios-ipa.zip'

$dlHeaders = @{
    Authorization = "Bearer $Token"
    Accept        = "application/vnd.github+json"
    "User-Agent"  = "xunyin-build"
}
Invoke-WebRequest -Uri "$api/repos/$User/$Repo/actions/artifacts/$($ipaArt.id)/zip" `
    -Headers $dlHeaders -OutFile $zipPath -TimeoutSec 300
Ok ("已下载: " + $zipPath + "  (" + [Math]::Round((Get-Item $zipPath).Length / 1KB, 1) + " KB)")

# ---------- 6. 解压 ----------
Step '解压 IPA'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$extractDir = Join-Path $outDir 'ios'
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractDir)

$ipa = Get-ChildItem $extractDir -Recurse -Filter *.ipa | Select-Object -First 1
if ($ipa) {
    $finalIpa = Join-Path $outDir '寻音-unsigned.ipa'
    Copy-Item $ipa.FullName $finalIpa -Force
    Ok ("IPA 就绪: " + $finalIpa)
    Write-Host ("    大小: " + [Math]::Round((Get-Item $finalIpa).Length / 1MB, 2) + " MB")
} else {
    Warn '解开压缩包但没找到 .ipa'
    Get-ChildItem $extractDir -Recurse -File | Select-Object -First 10 | ForEach-Object { Write-Host ("    " + $_.FullName) }
}

Write-Host "`n=== 完成 ===" -ForegroundColor Cyan
Write-Host "下一步：把 IPA 传到 iPhone，用 NB助手 导入 Apple ID 签名安装" -ForegroundColor White
