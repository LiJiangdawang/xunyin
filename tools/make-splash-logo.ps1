Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

function MakeSplashLogo($src, $dst, $size) {
  $raw = New-Object System.Drawing.Bitmap($src)
  $w = $raw.Width; $h = $raw.Height

  # 漂白浅灰底，只留深色图形
  $img = New-Object System.Drawing.Bitmap($w, $h)
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $c = $raw.GetPixel($x, $y)
      $lum = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
      if ($lum -gt 200) {
        $img.SetPixel($x, $y, [System.Drawing.Color]::White)
      } elseif ($lum -gt 110) {
        $t = ($lum - 110) / 90.0
        $rr = [int]($c.R + (255 - $c.R) * $t)
        $gg = [int]($c.G + (255 - $c.G) * $t)
        $bb = [int]($c.B + (255 - $c.B) * $t)
        $img.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($rr, $gg, $bb))
      } else {
        $img.SetPixel($x, $y, $c)
      }
    }
  }
  $raw.Dispose()

  $minX = $w; $minY = $h; $maxX = 0; $maxY = 0
  for ($y = 0; $y -lt $h; $y += 2) {
    for ($x = 0; $x -lt $w; $x += 2) {
      $c = $img.GetPixel($x, $y)
      if ((0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B) -lt 200) {
        if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $cw = $maxX - $minX; $ch = $maxY - $minY
  $side = [Math]::Max($cw, $ch)

  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

  $pad = [int]($size * 0.12)
  $box = New-Object System.Drawing.Rectangle($pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = [int]($size * 0.15)
  $path.AddArc($box.X, $box.Y, $r, $r, 180, 90)
  $path.AddArc(($box.Right - $r), $box.Y, $r, $r, 270, 90)
  $path.AddArc(($box.Right - $r), ($box.Bottom - $r), $r, $r, 0, 90)
  $path.AddArc($box.X, ($box.Bottom - $r), $r, $r, 90, 90)
  $path.CloseFigure()
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillPath($brush, $path)

  $target = [int](($size - 2 * $pad) * 0.84)
  $scale = $target / $side
  $dw = [int]($cw * $scale); $dh = [int]($ch * $scale)
  $dx = [int](($size - $dw) / 2); $dy = [int](($size - $dh) / 2)
  $srcRect = New-Object System.Drawing.Rectangle($minX, $minY, $cw, $ch)
  $dstRect = New-Object System.Drawing.Rectangle($dx, $dy, $dw, $dh)
  $g.DrawImage($img, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); $img.Dispose()

  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  $out.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  Write-Output ("  splash_logo " + $size + "x" + $size)
}

$src = "F:\Deepseak\whalemusic\assets_src\icon-headphones.jpg"
$res = "F:\Deepseak\whalemusic\native\android\res"
MakeSplashLogo $src "$res\drawable-mdpi\splash_logo.png" 144
MakeSplashLogo $src "$res\drawable-hdpi\splash_logo.png" 216
MakeSplashLogo $src "$res\drawable-xhdpi\splash_logo.png" 288
MakeSplashLogo $src "$res\drawable-xxhdpi\splash_logo.png" 432
MakeSplashLogo $src "$res\drawable-xxxhdpi\splash_logo.png" 576
