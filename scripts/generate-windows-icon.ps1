$ErrorActionPreference = "Stop"

$sourcePath = Join-Path $PSScriptRoot "..\assets\nowaikonafolioglyph.ico"
$targetPath = Join-Path $PSScriptRoot "..\build\folio.ico"
$expectedSha256 = "036400f9180f5e26a2bd44971222371062a469f8f16460affb2918ffe97ba46d"
$expectedSizes = @(16, 24, 32, 48, 64, 72, 96, 128, 256)

if (-not (Test-Path $sourcePath)) { throw "Approved Folio glyph ICO source is missing: $sourcePath" }
$sourceHash = (Get-FileHash $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sourceHash -ne $expectedSha256) { throw "Approved Folio glyph ICO checksum mismatch: $sourceHash" }

$targetDirectory = Split-Path -Parent $targetPath
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
Copy-Item $sourcePath $targetPath -Force

$bytes = [System.IO.File]::ReadAllBytes($targetPath)
if ($bytes.Length -lt 6 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0 -or [BitConverter]::ToUInt16($bytes, 2) -ne 1) {
  throw "Folio glyph ICO has an invalid header."
}
$count = [BitConverter]::ToUInt16($bytes, 4)
if ($count -ne $expectedSizes.Count) { throw "Folio glyph ICO must contain $($expectedSizes.Count) frames, found $count." }

$actualSizes = @()
for ($index = 0; $index -lt $count; $index++) {
  $entry = 6 + (16 * $index)
  $width = [int]$bytes[$entry]
  $height = [int]$bytes[$entry + 1]
  if ($width -eq 0) { $width = 256 }
  if ($height -eq 0) { $height = 256 }
  if ($width -ne $height) { throw "Folio glyph ICO frame $index is not square: $width x $height." }
  $length = [BitConverter]::ToUInt32($bytes, $entry + 8)
  $offset = [BitConverter]::ToUInt32($bytes, $entry + 12)
  if ($offset + $length -gt $bytes.Length -or $length -lt 8) { throw "Folio glyph ICO has an invalid frame at index $index." }
  $actualSizes += $width
}

if (($actualSizes -join ",") -ne ($expectedSizes -join ",")) {
  throw "Folio glyph ICO frame sizes mismatch. Found: $($actualSizes -join ', ')"
}
$targetHash = (Get-FileHash $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($targetHash -ne $expectedSha256) { throw "Copied Folio glyph ICO checksum mismatch: $targetHash" }

Write-Host "Validated approved Folio glyph ICO ($($expectedSizes -join ', ')px): $targetPath"
Write-Host "SHA-256: $targetHash"
