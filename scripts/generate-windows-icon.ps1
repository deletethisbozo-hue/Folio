$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $PSScriptRoot "..\assets\folio-icon.png"
$targetPath = Join-Path $PSScriptRoot "..\build\folio.ico"
if (-not (Test-Path $sourcePath)) { throw "Approved Folio PNG source is missing: $sourcePath" }
$targetDirectory = Split-Path -Parent $targetPath
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null

$source = [System.Drawing.Image]::FromFile((Resolve-Path $sourcePath))
$frames = [System.Collections.Generic.List[object]]::new()
$writer = $null
$stream = $null
try {
  foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $memory = [System.IO.MemoryStream]::new()
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.DrawImage($source, 0, 0, $size, $size)
      $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
      $frames.Add(@{ Size = $size; Data = $memory.ToArray() })
    }
    finally {
      $memory.Dispose()
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }

  $stream = [System.IO.File]::Create($targetPath)
  $writer = [System.IO.BinaryWriter]::new($stream)
  $writer.Write([UInt16]0) # Reserved
  $writer.Write([UInt16]1) # ICO type
  $writer.Write([UInt16]$frames.Count)
  $offset = 6 + (16 * $frames.Count)
  foreach ($frame in $frames) {
    $dimension = if ($frame.Size -eq 256) { [byte]0 } else { [byte]$frame.Size }
    $writer.Write($dimension)
    $writer.Write($dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$frame.Data.Length)
    $writer.Write([UInt32]$offset)
    $offset += $frame.Data.Length
  }
  foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Data) }
  $writer.Flush()
}
finally {
  if ($writer) { $writer.Dispose() }
  elseif ($stream) { $stream.Dispose() }
  $source.Dispose()
}

$bytes = [System.IO.File]::ReadAllBytes($targetPath)
if ($bytes.Length -lt 6 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0 -or [BitConverter]::ToUInt16($bytes, 2) -ne 1 -or [BitConverter]::ToUInt16($bytes, 4) -ne 7) {
  throw "Generated Folio ICO has an invalid header."
}
foreach ($index in 0..6) {
  $entry = 6 + (16 * $index)
  $length = [BitConverter]::ToUInt32($bytes, $entry + 8)
  $offset = [BitConverter]::ToUInt32($bytes, $entry + 12)
  if ($offset + $length -gt $bytes.Length -or $length -lt 8) { throw "Generated Folio ICO has an invalid image entry at index $index." }
  if ($bytes[$offset] -ne 0x89 -or $bytes[$offset + 1] -ne 0x50 -or $bytes[$offset + 2] -ne 0x4E -or $bytes[$offset + 3] -ne 0x47) {
    throw "Generated Folio ICO frame $index is not a PNG payload."
  }
}
Write-Host "Generated valid multi-resolution Folio ICO (16, 24, 32, 48, 64, 128, 256px): $targetPath"
