# =============================================================
# 寻音 · 一键出 IPA（自动版）
#   - 不需要手动提供 token
#   - 第一次运行会弹浏览器让你登录 GitHub，登录一次即可
#   - 之后自动：建仓库 → 推送 → 编译 → 下载 IPA
# =============================================================
param(
    [string]$User = "LiJiangdawang",
    [string]$Repo = "xunyin",
    [string]$ProjectDir = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = 'Continue'
$OutputEncoding = [System.Text.Encoding]::UTF8
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Title($t) {
    Write-Host ""
    Write-Host ("=" * 56) -ForegroundColor DarkCyan
    Write-Host ("  " + $t) -ForegroundColor Cyan
    Write-Host ("=" * 56) -ForegroundColor DarkCyan
}
function Step($m) { Write-Host ("`n>>> " + $m) -ForegroundColor Cyan }
function Ok($m) { Write-Host ("    [OK] " + $m) -ForegroundColor Green }
function Info($m) { Write-Host ("    " + $m) -ForegroundColor Gray }
function Warn($m) { Write-Host ("    [!] " + $m) -ForegroundColor Yellow }
function Die($m) {
    Write-Host ""
    Write-Host ("[失败] " + $m) -ForegroundColor Red
    Write-Host ""
    Write-Host "按任意键退出..." -ForegroundColor DarkGray
    try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { }
    exit 1
}

Title "寻音 · 一键构建 iOS IPA"

# ---------- 0. 环境检查 ----------
Step '检查环境'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die '没有找到 git，请先安装 Git for Windows' }
Ok ("git " + (git --version))
if (-not (Test-Path (Join-Path $ProjectDir '.git'))) { Die ('项目不是 git 仓库: ' + $ProjectDir) }
Ok '项目仓库正常'
Info ("目标: https://github.com/$User/$Repo")

# ---------- 1. 获取 GitHub 凭据 ----------
Step '获取 GitHub 授权'

function Get-GitHubToken {
    # 先看系统里有没有已保存的凭据
    $probe = "protocol=https`nhost=github.com`n`n"
    $out = ($probe | git credential fill 2>&1 | Out-String)
    if ($out -match 'password=(.+)') {
        return $matches[1].Trim()
    }
    return $null
}

$token = Get-GitHubToken

if (-not $token) {
    Warn '这台电脑还没登录过 GitHub，现在会弹出登录窗口'
    Info '浏览器里登录你的账号并授权即可，只需一次'
    Write-Host ""
    Write-Host "    >>> 稍等，马上弹出浏览器..." -ForegroundColor Yellow
    Write-Host ""

    # 用一次需要认证的访问来触发 Git Credential Manager 登录
    git -c credential.helper=manager ls-remote "https://github.com/$User/$Repo.git" 2>&1 | Out-Null

    Start-Sleep -Seconds 2
    $token = Get-GitHubToken
}

if (-not $token) {
    Write-Host ""
    Warn '没有拿到授权。可能是登录窗口被关掉了。'
    Info '有两个办法：'
    Info '  A. 重新运行本文件，这次留意浏览器弹窗并完成登录'
    Info '  B. 手动执行一次: git ls-remote https://github.com 完成登录后再运行'
    Die '缺少 GitHub 授权'
}
Ok ('已获得授权令牌 (' + $token.Substring(0, [Math]::Min(7, $token.Length)) + '...)')

$headers = @{
    Authorization          = "Bearer $token"
    Accept                 = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
    "User-Agent"           = "xunyin-auto"
}

# ---------- 2. 验证账号 ----------
Step '验证账号'
try {
    $me = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers -TimeoutSec 30
    Ok ("已登录: " + $me.login)
    if ($me.login -ne $User) {
        Warn ("授权账号是 " + $me.login + "，不是 " + $User)
        Info "改用实际登录的账号继续"
        $User = $me.login
    }
} catch {
    Die ("token 校验失败: " + $_.Exception.Message)
}

# ---------- 3. 创建仓库 ----------
Step "准备仓库 $User/$Repo"
$exists = $false
try {
    $null = Invoke-RestMethod -Uri "https://api.github.com/repos/$User/$Repo" -Headers $headers -TimeoutSec 30
    $exists = $true
    Ok '仓库已存在'
} catch { }

if (-not $exists) {
    Info '仓库不存在，正在创建…'
    try {
        $body = @{
            name        = $Repo
            private     = $false
            description = '寻音 XunYin - 全离线音乐播放器'
            has_issues  = $false
        } | ConvertTo-Json
        $null = Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post `
            -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 40
        Ok ("已创建: https://github.com/$User/$Repo")
    } catch {
        Die ("创建仓库失败: " + $_.Exception.Message + "`n    可能是 token 缺少 Administration 权限，请先手动在网页建一个空仓库再重跑")
    }
}

# ---------- 4. 推送代码 ----------
Step '推送代码'
Push-Location $ProjectDir
try {
    $remoteUrl = "https://github.com/$User/$Repo.git"
    $existing = git remote 2>$null
    if ($existing -contains 'origin') {
        git remote set-url origin $remoteUrl 2>&1 | Out-Null
    } else {
        git remote add origin $remoteUrl 2>&1 | Out-Null
    }
    # 确保走 GCM，不带 token 进 URL（避免凭证泄露到 .git/config）
    git config --local credential.helper manager

    $branch = git branch --show-current
    if (-not $branch) { $branch = 'main' }

    Info ("推送分支: " + $branch)
    $pushOut = git push -u origin $branch --force 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        Write-Host $pushOut -ForegroundColor Red
        Die '推送失败（如果提示 workflow 权限，重新授权时请勾选 workflow）'
    }
    Ok '推送完成'
} finally {
    Pop-Location
}

# ---------- 5. 触发构建 ----------
Step '触发 iOS 编译'
Start-Sleep -Seconds 4
$dispatched = $false
try {
    $body = @{ ref = $branch } | ConvertTo-Json
    $null = Invoke-RestMethod -Uri "https://api.github.com/repos/$User/$Repo/actions/workflows/ios.yml/dispatches" `
        -Method Post -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 30
    $dispatched = $true
    Ok '已手动触发 workflow'
} catch {
    Warn '手动触发失败，可能 push 已自动触发: ' + $_.Exception.Message
}

# ---------- 6. 等待 ----------
Step '等待编译完成（大约 8~15 分钟，别关窗口）'
$runId = $null
$deadline = (Get-Date).AddMinutes(30)
$lastStatus = ''
$tipShown = $false

while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 12
    try {
        $runs = Invoke-RestMethod -Uri "https://api.github.com/repos/$User/$Repo/actions/runs?per_page=8" -Headers $headers -TimeoutSec 30
        $run = $runs.workflow_runs | Where-Object { $_.name -like '*iOS*' } | Select-Object -First 1
        if (-not $run) {
            if (-not $tipShown) {
                Info '还没看到构建任务，继续等待…'
                $tipShown = $true
            }
            continue
        }
        $runId = $run.id
        $st = $run.status
        $cc = $run.conclusion
        $label = if ($st -eq 'completed') { "$st / $cc" } else { $st }
        if ($label -ne $lastStatus) {
            $t = (Get-Date -Format 'HH:mm:ss')
            Write-Host ("    " + $t + "  " + $label)
            $lastStatus = $label
        }
        if ($st -eq 'completed') { break }
    } catch {
        # 网络抖动忽略
    }
}

if (-not $runId) { Die '没有找到构建记录，请到 GitHub Actions 页面查看' }

$final = Invoke-RestMethod -Uri "https://api.github.com/repos/$User/$Repo/actions/runs/$runId" -Headers $headers -TimeoutSec 30
if ($final.conclusion -ne 'success') {
    Write-Host ""
    Warn ("构建结束: " + $final.conclusion)
    Info ("查看日志: " + $final.html_url)
    Die '编译没有成功，上面网址有详细日志'
}
Ok "编译成功"
Info ("构建页: " + $final.html_url)

# ---------- 7. 下载 IPA ----------
Step '下载 IPA'
$arts = Invoke-RestMethod -Uri "https://api.github.com/repos/$User/$Repo/actions/runs/$runId/artifacts" -Headers $headers -TimeoutSec 30
$art = $arts.artifacts | Where-Object { $_.name -eq 'xunyin-ios-ipa' } | Select-Object -First 1
if (-not $art) {
    Warn '没找到 IPA 产物，可用产物如下：'
    $arts.artifacts | ForEach-Object { Info ("  " + $_.name) }
    Die '产物缺失'
}

$outDir = Join-Path $ProjectDir 'dist'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipPath = Join-Path $outDir 'xunyin-ios-ipa.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Invoke-WebRequest -Uri "https://api.github.com/repos/$User/$Repo/actions/artifacts/$($art.id)/zip" `
    -Headers $headers -OutFile $zipPath -TimeoutSec 300
Ok ("已下载 (" + [Math]::Round((Get-Item $zipPath).Length / 1KB, 1) + " KB)")

# ---------- 8. 解包 ----------
Step '解包 IPA'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$extract = Join-Path $outDir 'ios-extract'
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extract)

$ipa = Get-ChildItem $extract -Recurse -Filter *.ipa | Select-Object -First 1
if (-not $ipa) { Die '压缩包里没有 .ipa 文件' }

$finalIpa = Join-Path $outDir '寻音-unsigned.ipa'
Copy-Item $ipa.FullName $finalIpa -Force

Title '全部完成'
Write-Host ""
Write-Host ("  IPA 文件: " + $finalIpa) -ForegroundColor Green
Write-Host ("  大小    : " + [Math]::Round((Get-Item $finalIpa).Length / 1MB, 2) + " MB") -ForegroundColor Green
Write-Host ""
Write-Host "  安装步骤:" -ForegroundColor White
Write-Host "    1. 把 IPA 传到 iPhone（微信/QQ 发给自己）" -ForegroundColor Gray
Write-Host "    2. 在「文件」里长按它 -> 分享 -> NB助手" -ForegroundColor Gray
Write-Host "    3. NB助手 右上角 + -> 导入 Apple ID" -ForegroundColor Gray
Write-Host "    4. 点 IPA -> 签名安装 -> 选证书" -ForegroundColor Gray
Write-Host "    5. 设置 -> 通用 -> VPN与设备管理 -> 信任" -ForegroundColor Gray
Write-Host ""
Write-Host "  注意: 免费 Apple ID 签名的 App 7 天后过期，到期用 NB助手重签即可" -ForegroundColor Yellow
Write-Host ""
Write-Host "按任意键关闭..." -ForegroundColor DarkGray
try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { }
