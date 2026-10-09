$ErrorActionPreference = "Stop"

# Keep the user-supplied NEUE.ico intact in every Windows build.
$sourcePath = Join-Path $PSScriptRoot "..\assets\NEUE.ico"
$targetPath = Join-Path $PSScriptRoot "..\build\folio.ico"
if (-not (Test-Path $sourcePath)) { throw "Folio NEUE.ico is missing: $sourcePath" }

$bytes = [System.IO.File]::ReadAllBytes($sourcePath)
if ($bytes.Length -lt 70 -or [BitConverter]::ToUInt16($bytes, 0) -ne 0 -or [BitConverter]::ToUInt16($bytes, 2) -ne 1) {
  throw "NEUE.ico does not have a valid Windows ICO header."
}
$count = [int][BitConverter]::ToUInt16($bytes, 4)
if ($count -lt 2 -or (6 + 16 * $count) -gt $bytes.Length) {
  throw "NEUE.ico contains an invalid number of images: $count."
}
$actualSizes = @()
for ($index = 0; $index -lt $count; $index++) {
  $entry = 6 + (16 * $index)
  $width = if ($bytes[$entry] -eq 0) { 256 } else { [int]$bytes[$entry] }
  $height = if ($bytes[$entry + 1] -eq 0) { 256 } else { [int]$bytes[$entry + 1] }
  $size = [uint32][BitConverter]::ToUInt32($bytes, $entry + 8)
  $offset = [uint32][BitConverter]::ToUInt32($bytes, $entry + 12)
  if ($width -ne $height -or $size -eq 0 -or $offset -lt (6 + 16 * $count) -or
      ([uint64]$offset + [uint64]$size) -gt [uint64]$bytes.Length) {
    throw "NEUE.ico image $index is invalid (size=$width x $height, offset=$offset, bytes=$size)."
  }
  $actualSizes += $width
}
if (-not ($actualSizes -contains 256) -or -not ($actualSizes -contains 16)) {
  throw "NEUE.ico needs 16px and 256px frames; found $($actualSizes -join ', ')."
}

$targetDirectory = Split-Path -Parent $targetPath
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null
Copy-Item -Force $sourcePath $targetPath
$sourceHash = (Get-FileHash $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
$targetHash = (Get-FileHash $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sourceHash -ne $targetHash) { throw "NEUE.ico staging changed the source icon." }
Write-Host "Validated NEUE.ico: $count square frames ($($actualSizes -join ', ') px), SHA-256=$sourceHash"
