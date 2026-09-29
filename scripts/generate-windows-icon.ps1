$ErrorActionPreference = "Stop"

$sourcePath = Join-Path $PSScriptRoot "..\assets\nowaikonafolioglyph.ico"
$targetPath = Join-Path $PSScriptRoot "..\build\folio.ico"
$expectedSha256 = "036400f9180f5e26a2bd44971222371062a469f8f16460affb2918ffe97ba46d"

if (-not (Test-Path $sourcePath)) { throw "Approved Folio glyph ICO is missing: $sourcePath" }
$actual = (Get-FileHash $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expectedSha256) { throw "Approved Folio glyph ICO checksum mismatch: $actual" }

$targetDirectory = Split-Path -Parent $targetPath
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
Copy-Item -Force $sourcePath $targetPath

$bytes = [System.IO.File]::ReadAllBytes($targetPath)
if ($bytes.Length -lt 6 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0 -or [BitConverter]::ToUInt16($bytes, 2) -ne 1) {
  throw "Folio glyph ICO has an invalid header."
}
$count = [BitConverter]::ToUInt16($bytes, 4)
if ($count -ne 9) { throw "Folio glyph ICO must contain exactly 9 frames, found $count." }

$expectedSizes = @(16, 24, 32, 48, 64, 72, 96, 128, 256)
$actualSizes = @()
for ($index = 0; $index -lt $count; $index++) {
  $entry = 6 + (16 * $index)
  $widthByte = $bytes[$entry]
  $heightByte = $bytes[$entry + 1]
  $width = if ($widthByte -eq 0) { 256 } else { [int]$widthByte }
  $height = if ($heightByte -eq 0) { 256 } else { [int]$heightByte }
  if ($width -ne $height) { throw "Folio glyph ICO frame $index is not square: $width x $height." }
  $actualSizes += $width
}
if (($actualSizes -join ",") -ne ($expectedSizes -join ",")) {
  throw "Folio glyph ICO sizes mismatch. Expected $($expectedSizes -join ', '), found $($actualSizes -join ', ')."
}
Write-Host "Validated exact Folio glyph ICO: $targetPath"
Write-Host "SHA-256: $actual"
