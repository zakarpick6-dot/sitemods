# Generates brand raster assets from the supplied 4K logo.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/make-brand-assets.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$source = Join-Path (Split-Path -Parent $root) 'revomaker-logo-4k.png'
if (-not (Test-Path $source)) {
  $source = Join-Path $root 'revomaker-logo-4k.png'
}
if (-not (Test-Path $source)) {
  Write-Error "Source logo not found. Place revomaker-logo-4k.png next to the project folder."
  exit 1
}

$brandDir = Join-Path $root 'public\assets\brand'
New-Item -ItemType Directory -Force -Path $brandDir | Out-Null

function Save-Resized {
  param([System.Drawing.Image]$Image, [int]$Width, [int]$Height, [string]$Target, [System.Drawing.Rectangle]$SourceRect = [System.Drawing.Rectangle]::Empty)
  $bmp = New-Object System.Drawing.Bitmap $Width, $Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $dest = New-Object System.Drawing.Rectangle 0, 0, $Width, $Height
  if ($SourceRect -eq [System.Drawing.Rectangle]::Empty) {
    $g.DrawImage($Image, $dest)
  } else {
    $g.DrawImage($Image, $dest, $SourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  }
  $g.Dispose()
  $bmp.Save($Target, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

$logo = [System.Drawing.Image]::FromFile($source)

# Full supplied artwork — the canonical server/site logo.
Save-Resized -Image $logo -Width 1200 -Height 1200 -Target (Join-Path $brandDir 'logo.png')
Save-Resized -Image $logo -Width 512 -Height 512 -Target (Join-Path $brandDir 'logo-512.png')
Save-Resized -Image $logo -Width 192 -Height 192 -Target (Join-Path $brandDir 'logo-192.png')

# Compact mark crop around the monogram, for favicons and small UI slots.
$crop = New-Object System.Drawing.Rectangle 100, 180, 800, 800
Save-Resized -Image $logo -Width 512 -Height 512 -Target (Join-Path $brandDir 'emblem.png') -SourceRect $crop
Save-Resized -Image $logo -Width 96 -Height 96 -Target (Join-Path $brandDir 'favicon.png') -SourceRect $crop
Save-Resized -Image $logo -Width 180 -Height 180 -Target (Join-Path $brandDir 'apple-touch-icon.png') -SourceRect $crop
Save-Resized -Image $logo -Width 256 -Height 256 -Target (Join-Path $brandDir 'emblem-256.png') -SourceRect $crop

# Open Graph cover (1200x630)
$og = New-Object System.Drawing.Bitmap 1200, 630
$g = [System.Drawing.Graphics]::FromImage($og)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

$bg = New-Object System.Drawing.Rectangle 0, 0, 1200, 630
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $bg, ([System.Drawing.Color]::FromArgb(255, 10, 10, 16)), ([System.Drawing.Color]::FromArgb(255, 5, 5, 9)), 45
$g.FillRectangle($brush, $bg)
$brush.Dispose()

for ($i = 10; $i -ge 1; $i--) {
  $w = 900 * $i / 10
  $h = 560 * $i / 10
  $alpha = [Math]::Max(2, 16 - $i)
  $glow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alpha, 124, 58, 237))
  $g.FillEllipse($glow, (600 - $w / 2), (315 - $h / 2), $w, $h)
  $glow.Dispose()
}

$logoMark = New-Object System.Drawing.Bitmap 1200, 1200
$lg = [System.Drawing.Graphics]::FromImage($logoMark)
$lg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$lg.DrawImage($logo, (New-Object System.Drawing.Rectangle 0, 0, 1200, 1200))
$lg.Dispose()

$g.DrawImage($logoMark, (New-Object System.Drawing.Rectangle 480, 44, 240, 240))
$logoMark.Dispose()

$titleFont = New-Object System.Drawing.Font 'Segoe UI', 54, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$titleBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 245, 255))
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$g.DrawString('REVOMAKER STEAM', $titleFont, $titleBrush, (New-Object System.Drawing.PointF 600, 342), $format)
$titleBrush.Dispose()
$titleFont.Dispose()

$subFont = New-Object System.Drawing.Font 'Consolas', 19, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$subBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(205, 56, 189, 248))
$g.DrawString('LIVE GAMING DROP NETWORK', $subFont, $subBrush, (New-Object System.Drawing.PointF 600, 440), $format)
$subBrush.Dispose()
$subFont.Dispose()

$linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(140, 139, 92, 246)), 2
$g.DrawLine($linePen, 470, 500, 730, 500)
$linePen.Dispose()

$bottomFont = New-Object System.Drawing.Font 'Consolas', 15, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$bottomBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 255, 255, 255))
$g.DrawString('CURATED DROPS  /  REAL ANALYTICS  /  OWNER-CONTROLLED', $bottomFont, $bottomBrush, (New-Object System.Drawing.PointF 600, 545), $format)
$bottomBrush.Dispose()
$bottomFont.Dispose()

$g.Dispose()
$og.Save((Join-Path $brandDir 'og-cover.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$og.Dispose()

$logo.Dispose()
Write-Host "Brand assets written to $brandDir"
