$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root "assets\folio-icon.png"
$outPath = Join-Path $root "assets\folio-icon.ico"
$sizes = @(16, 32, 48, 64, 128, 256)

$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
  $images = @()
  foreach ($size in $sizes) {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($source, 0, 0, $size, $size)
      }
      finally {
        $graphics.Dispose()
      }

      $stream = New-Object System.IO.MemoryStream
      try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $images += ,@($size, $stream.ToArray())
      }
      finally {
        $stream.Dispose()
      }
    }
    finally {
      $bitmap.Dispose()
    }
  }
}
finally {
  $source.Dispose()
}

$headerSize = 6 + (16 * $images.Count)
$offset = $headerSize
$output = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($output)

try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$images.Count)

  foreach ($item in $images) {
    $size = [int]$item[0]
    [byte[]]$png = $item[1]
    $dimension = if ($size -eq 256) { 0 } else { $size }

    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$png.Length)
    $writer.Write([UInt32]$offset)
    $offset += $png.Length
  }

  foreach ($item in $images) {
    [byte[]]$png = $item[1]
    $writer.Write($png)
  }

  $writer.Flush()
  [System.IO.File]::WriteAllBytes($outPath, $output.ToArray())
}
finally {
  $writer.Dispose()
  $output.Dispose()
}

$bytes = [System.IO.File]::ReadAllBytes($outPath)
$count = [BitConverter]::ToUInt16($bytes, 4)
if ($count -ne $sizes.Count) {
  throw "ICO entry count mismatch: expected $($sizes.Count), got $count"
}

$actual = @()
for ($i = 0; $i -lt $count; $i++) {
  $value = $bytes[6 + ($i * 16)]
  $actual += $(if ($value -eq 0) { 256 } else { [int]$value })
}
if (($actual -join ",") -ne ($sizes -join ",")) {
  throw "ICO sizes mismatch: $($actual -join ', ')"
}

Write-Host "Generated Folio Windows icon: $outPath"
Write-Host "Sizes: $($actual | ForEach-Object { "$($_)x$($_)" } | Join-String -Separator ', ')"
