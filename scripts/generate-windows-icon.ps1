$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root "assets\folio-icon.png"
$outPath = Join-Path $root "assets\folio-icon.ico"
$expectedSizes = @(16, 32, 48, 64, 128, 256)

$magick = Get-Command magick.exe -ErrorAction Stop
& $magick.Source $sourcePath -background none -define icon:auto-resize=256,128,64,48,32,16 $outPath
if ($LASTEXITCODE -ne 0) {
  throw "ImageMagick failed to generate Folio Windows icon."
}
if (-not (Test-Path $outPath)) {
  throw "Folio Windows icon was not created."
}

[byte[]]$bytes = [System.IO.File]::ReadAllBytes($outPath)
if ($bytes.Length -lt 22) {
  throw "Generated ICO is unexpectedly small."
}
$count = [BitConverter]::ToUInt16($bytes, 4)
if ($count -ne $expectedSizes.Count) {
  throw "ICO entry count mismatch: expected $($expectedSizes.Count), got $count"
}

$actual = @()
for ($i = 0; $i -lt $count; $i++) {
  $value = $bytes[6 + ($i * 16)]
  $actual += $(if ($value -eq 0) { 256 } else { [int]$value })
}
$actualSorted = $actual | Sort-Object
$expectedSorted = $expectedSizes | Sort-Object
if (($actualSorted -join ",") -ne ($expectedSorted -join ",")) {
  throw "ICO sizes mismatch: $($actual -join ', ')"
}

Write-Host "Generated Folio Windows icon: $outPath"
Write-Host "Sizes: $($actual | ForEach-Object { "$($_)x$($_)" } | Join-String -Separator ', ')"
