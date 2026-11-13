/* 图片处理：用 Windows 自带 System.Drawing 完成裁剪、缩放、抠图
   用法: node tools/prepare-images.js
*/
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets_src');
const WWW = path.join(ROOT, 'www');
const RES = path.join(ROOT, 'native', 'android', 'res');

function ps(script) {
  const file = path.join(ROOT, '_tmp_img.ps1');
  fs.writeFileSync(file, '\uFEFF' + script, 'utf8');
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], {
    encoding: 'utf8'
  });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error('Powershell 处理失败');
  }
  fs.unlinkSync(file);
  return r.stdout;
}

const script = `
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

function LoadImg([string]$p) {
  $bmp = New-Object System.Drawing.Bitmap($p)
  return $bmp
}

# ---------- 通用缩放 ----------
function SaveResized($src, $dst, [int]$w, [int]$h, [bool]$keepRatio, [string]$fmt) {
  $img = LoadImg $src
  $nw = $w; $nh = $h
  if ($keepRatio) {
    $ratio = [Math]::Min($w / $img.Width, $h / $img.Height)
    $nw = [int][Math]::Round($img.Width * $ratio)
    $nh = [int][Math]::Round($img.Height * $ratio)
  }
  $out = New-Object System.Drawing.Bitmap($nw, $nh)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $nw, $nh)
  $g.Dispose()
  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  if ($fmt -eq 'png') { $out.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png) }
  else { $out.Save($dst, [System.Drawing.Imaging.ImageFormat]::Jpeg) }
  $out.Dispose(); $img.Dispose()
  Write-Output ("  " + (Split-Path $dst -Leaf) + "  " + $nw + "x" + $nh)
}

# ---------- 图标：去白底 + 取内容外接框 ----------
function MakeIcon($src, $dst, [int]$size, [double]$contentRatio, [bool]$roundBg) {
  $img = LoadImg $src
  $w = $img.Width; $h = $img.Height

  # 先把浅灰底漂白，只保留深色图形
  $clean = New-Object System.Drawing.Bitmap($w, $h)
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $c = $img.GetPixel($x, $y)
      $lum = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
      if ($lum -gt 200) {
        $clean.SetPixel($x, $y, [System.Drawing.Color]::White)
      } elseif ($lum -gt 120) {
        # 边缘抗锯齿：按亮度在白色与深色间过渡，去掉灰雾
        $t = ($lum - 120) / 80.0
        $r = [int]($c.R + (255 - $c.R) * $t)
        $g2 = [int]($c.G + (255 - $c.G) * $t)
        $b2 = [int]($c.B + (255 - $c.B) * $t)
        $clean.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($r, $g2, $b2))
      } else {
        $clean.SetPixel($x, $y, $c)
      }
    }
  }
  $img.Dispose()
  $img = $clean

  # 找内容包围盒（非白像素）
  $minX = $w; $minY = $h; $maxX = 0; $maxY = 0
  for ($y = 0; $y -lt $h; $y += 2) {
    for ($x = 0; $x -lt $w; $x += 2) {
      $c = $img.GetPixel($x, $y)
      $lum = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
      if ($lum -lt 225) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $cw = $maxX - $minX; $ch = $maxY - $minY
  $side = [Math]::Max($cw, $ch)

  # 输出画布
  $out = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($out)

  # 背景（纯白底图标 → 用白；自适应图标另处理）
  $g.Clear([System.Drawing.Color]::White)

  $target = [int]($size * $contentRatio)
  $scale = $target / $side
  $dw = [int]($cw * $scale)
  $dh = [int]($ch * $scale)
  $dx = [int](($size - $dw) / 2)
  $dy = [int](($size - $dh) / 2)

  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $srcRect = New-Object System.Drawing.Rectangle($minX, $minY, $cw, $ch)
  $dstRect = New-Object System.Drawing.Rectangle($dx, $dy, $dw, $dh)
  $g.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()

  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  $out.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose(); $img.Dispose()
  Write-Output ("  ICON " + (Split-Path $dst -Leaf) + "  " + $size + "x" + $size + "  bbox=" + $cw + "x" + $ch)
}

# ---------- 收款码：去掉外围白边，保留完整卡片 ----------
function CropQR($src, $dst) {
  $img = LoadImg $src
  $w = $img.Width; $h = $img.Height
  # 找非白内容外接框
  $minX = $w; $minY = $h; $maxX = 0; $maxY = 0
  for ($y = 0; $y -lt $h; $y += 2) {
    for ($x = 0; $x -lt $w; $x += 2) {
      $c = $img.GetPixel($x, $y)
      if (($c.R + $c.G + $c.B) / 3 -lt 248) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $pad = 6
  $x0 = [Math]::Max(0, $minX - $pad); $y0 = [Math]::Max(0, $minY - $pad)
  $x1 = [Math]::Min($w - 1, $maxX + $pad); $y1 = [Math]::Min($h - 1, $maxY + $pad)
  $rect = New-Object System.Drawing.Rectangle($x0, $y0, ($x1 - $x0), ($y1 - $y0))
  $cropped = $img.Clone($rect, $img.PixelFormat)
  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  $cropped.Save($dst, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  Write-Output ("  QR " + $cropped.Width + "x" + $cropped.Height)
  $cropped.Dispose(); $img.Dispose()
}

# ---------- 启动页标语图：去白底 ----------
function StripWhite($src, $dst) {
  $img = LoadImg $src
  $minX = $img.Width; $minY = $img.Height; $maxX = 0; $maxY = 0
  for ($y = 0; $y -lt $img.Height; $y += 2) {
    for ($x = 0; $x -lt $img.Width; $x += 2) {
      $c = $img.GetPixel($x, $y)
      if (($c.R + $c.G + $c.B) / 3 -lt 245) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $pad = 10
  $x0 = [Math]::Max(0, $minX - $pad); $y0 = [Math]::Max(0, $minY - $pad)
  $x1 = [Math]::Min($img.Width - 1, $maxX + $pad); $y1 = [Math]::Min($img.Height - 1, $maxY + $pad)
  $rect = New-Object System.Drawing.Rectangle($x0, $y0, ($x1 - $x0), ($y1 - $y0))
  $c2 = $img.Clone($rect, $img.PixelFormat)
  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  $c2.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output ("  SLOGAN " + $c2.Width + "x" + $c2.Height)
  $c2.Dispose(); $img.Dispose()
}

Write-Output "=== 应用图标 ==="
MakeIcon "${SRC}\\icon-headphones.jpg" "${WWW}\\icons\\icon-512.png" 512 0.78 $false
MakeIcon "${SRC}\\icon-headphones.jpg" "${WWW}\\icons\\icon-192.png" 192 0.78 $false
MakeIcon "${SRC}\\icon-headphones.jpg" "${WWW}\\icons\\icon-maskable-512.png" 512 0.60 $false
MakeIcon "${SRC}\\icon-headphones.jpg" "${WWW}\\icons\\icon-1024.png" 1024 0.78 $false

Write-Output "=== Android launcher ==="
$dens = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($k in $dens.Keys) {
  $s = $dens[$k]
  MakeIcon "${SRC}\\icon-headphones.jpg" "${RES}\\mipmap-$k\\ic_launcher.png" $s 0.80 $false
  MakeIcon "${SRC}\\icon-headphones.jpg" "${RES}\\mipmap-$k\\ic_launcher_round.png" $s 0.72 $false
  MakeIcon "${SRC}\\icon-headphones.jpg" "${RES}\\mipmap-$k\\ic_launcher_fg.png" ([int]($s * 1.5)) 0.52 $false
}

Write-Output "=== 收款码 ==="
CropQR "${SRC}\\qr-donate.jpg" "${WWW}\\img\\qr-donate.jpg"

Write-Output "=== 启动页标语 ==="
StripWhite "${SRC}\\splash-title.jpg" "${WWW}\\img\\slogan.png"
`;

console.log(ps(script));
