/* 生成 Android launcher 图标（从用户的耳机图派生，前后景分离）
   用法: node tools/make-launcher-icons.js [res 目录]
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RES = process.argv[2] || path.join(__dirname, '..', 'native', 'android', 'res');
const SRC = path.join(__dirname, '..', 'assets_src', 'icon-headphones.jpg');

const DENSITIES = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192]
];

/* 用 System.Drawing 一次性生成：圆形/方形图标（白底）+ 透明前景 */
const ps = `
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$srcPath = "${SRC.replace(/\\/g, '\\\\')}"

# 加载并漂白背景，取内容包围盒
function Prepare {
  $raw = New-Object System.Drawing.Bitmap($srcPath)
  $w = $raw.Width; $h = $raw.Height
  $img = New-Object System.Drawing.Bitmap($w, $h)
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $c = $raw.GetPixel($x, $y)
      $lum = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
      if ($lum -gt 200) { $img.SetPixel($x, $y, [System.Drawing.Color]::White) }
      elseif ($lum -gt 110) {
        $t = ($lum - 110) / 90.0
        $img.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(
          [int]($c.R + (255-$c.R)*$t), [int]($c.G + (255-$c.G)*$t), [int]($c.B + (255-$c.B)*$t)))
      } else { $img.SetPixel($x, $y, $c) }
    }
  }
  $raw.Dispose()

  $minX = $w; $minY = $h; $maxX = 0; $maxY = 0
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $c = $img.GetPixel($x, $y)
      if ((0.299*$c.R + 0.587*$c.G + 0.114*$c.B) -lt 200) {
        if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  return @{ img = $img; rect = (New-Object System.Drawing.Rectangle($minX, $minY, ($maxX-$minX), ($maxY-$minY))) }
}

$data = Prepare
$img = $data.img
$rect = $data.rect

# 透明前景：只画图形，无底色，供 adaptive-icon 叠加
function MakeForeground($path, $size) {
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  # 自适应图标安全区：内容只占内 66%
  $target = [int]($size * 0.60)
  $scale = $target / [Math]::Max($rect.Width, $rect.Height)
  $dw = [int]($rect.Width * $scale); $dh = [int]($rect.Height * $scale)
  $dx = [int](($size - $dw) / 2); $dy = [int](($size - $dh) / 2)
  $dst = New-Object System.Drawing.Rectangle($dx, $dy, $dw, $dh)
  $g.DrawImage($img, $dst, $rect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  Write-Output ("  fg   " + $size + "x" + $size)
}

# 圆角方形图标：白底 + 图形（老系统与部分启动器直接用这个）
function MakeSquare($path, $size, $radiusRatio, $contentRatio) {
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $r = [int]($size * $radiusRatio)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc(0, 0, $r*2, $r*2, 180, 90)
  $p.AddArc($size-$r*2, 0, $r*2, $r*2, 270, 90)
  $p.AddArc($size-$r*2, $size-$r*2, $r*2, $r*2, 0, 90)
  $p.AddArc(0, $size-$r*2, $r*2, $r*2, 90, 90)
  $p.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillPath($brush, $p)

  $target = [int]($size * $contentRatio)
  $scale = $target / [Math]::Max($rect.Width, $rect.Height)
  $dw = [int]($rect.Width * $scale); $dh = [int]($rect.Height * $scale)
  $dx = [int](($size - $dw) / 2); $dy = [int](($size - $dh) / 2)
  $dst = New-Object System.Drawing.Rectangle($dx, $dy, $dw, $dh)
  $g.DrawImage($img, $dst, $rect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  Write-Output ("  icon " + $size + "x" + $size)
}

# 圆形图标（ic_launcher_round）
function MakeRound($path, $size) {
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillEllipse($brush, 0, 0, $size, $size)

  $target = [int]($size * 0.62)
  $scale = $target / [Math]::Max($rect.Width, $rect.Height)
  $dw = [int]($rect.Width * $scale); $dh = [int]($rect.Height * $scale)
  $dx = [int](($size - $dw) / 2); $dy = [int](($size - $dh) / 2)
  $dst = New-Object System.Drawing.Rectangle($dx, $dy, $dw, $dh)
  $g.DrawImage($img, $dst, $rect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  New-Item -ItemType Directory -Force -Path (Split-Path $path -Parent) | Out-Null
  $out.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  Write-Output ("  round " + $size + "x" + $size)
}
`;

/* 写临时 ps1 并执行 */
const tmp = path.join(__dirname, '_launcher_tmp.ps1');
let body = ps;
for (const [dir, size] of DENSITIES) {
  const d = path.join(RES, dir).replace(/\\/g, '/');
  body += `\nMakeSquare "${d}/ic_launcher.png" ${size} 0.22 0.78\n`;
  body += `MakeRound "${d}/ic_launcher_round.png" ${size}\n`;
  body += `MakeForeground "${d}/ic_launcher_fg.png" ${Math.round(size * 1.5)}\n`;
}
body += `Write-Output "launcher icons ok"\n`;

fs.writeFileSync(tmp, '\uFEFF' + body, 'utf8');
const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], { encoding: 'utf8' });
fs.unlinkSync(tmp);
if (r.status !== 0) {
  console.error(r.stdout, r.stderr);
  process.exit(1);
}
process.stdout.write(r.stdout);
console.log('输出目录:', RES);
