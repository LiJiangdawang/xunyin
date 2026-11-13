@echo off
chcp 65001 >nul
title 寻音 - 一键构建 iOS IPA
cd /d "%~dp0"

echo.
echo   ============================================
echo      寻音 · 一键构建 iOS IPA
echo   ============================================
echo.
echo   这个窗口会自动完成：
echo     1. 让你登录一次 GitHub（弹浏览器，只需一次）
echo     2. 自动建仓库并推送代码
echo     3. 在 GitHub 云端编译 iOS 包
echo     4. 下载编译好的 IPA 到 dist 文件夹
echo.
echo   整个过程约 10 分钟，请不要关闭窗口。
echo.
pause

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build-ipa-auto.ps1"

if errorlevel 1 (
    echo.
    echo   出错了，请把上面的红色文字截图发给我。
    pause
)
