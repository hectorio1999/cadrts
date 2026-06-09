# Generate placeholder app icons for Tauri.
# Run once before first build, or commit the output to source control.
# Tauri's resource embedder requires icon.ico on Windows; the PNG/ICNS files
# are only needed when running `tauri build` for that platform.

[CmdletBinding()]
param(
  [string]$OutDir = (Join-Path $PSScriptRoot '..\src-tauri\icons')
)

Add-Type -AssemblyName System.Drawing

$OutDir = (Resolve-Path -LiteralPath $OutDir -ErrorAction SilentlyContinue)
if (-not $OutDir) {
  $OutDir = Join-Path $PSScriptRoot '..\src-tauri\icons'
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $OutDir = (Resolve-Path -LiteralPath $OutDir)
}

function New-AppIcon([int]$Size) {
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::FromArgb(255, 11, 13, 16))     # ink-900
  $accent = [System.Drawing.Color]::FromArgb(255, 255, 122, 89)   # accent
  $brush  = New-Object System.Drawing.SolidBrush $accent
  $pad    = [int]($Size * 0.18)
  $g.FillEllipse($brush, $pad, $pad, $Size - 2*$pad, $Size - 2*$pad)
  $inner  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 13, 16))
  $g.FillEllipse($inner, [int]($Size*0.32), [int]($Size*0.32), [int]($Size*0.36), [int]($Size*0.36))
  $g.Dispose()
  return ,$bmp
}

# Pre-rendered raster sizes Tauri references in tauri.conf.json.
# `icon-source.png` is the 1024×1024 master `tauri icon` can regenerate
# the full set from on any platform (incl. real .icns on macOS CI runners).
$sizes = @{
  '32x32.png'       = 32
  '128x128.png'     = 128
  '128x128@2x.png'  = 256
  'icon-source.png' = 1024
}
foreach ($name in $sizes.Keys) {
  $bmp = New-AppIcon $sizes[$name]
  $bmp.Save((Join-Path $OutDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  wrote $name"
}

# Multi-size ICO for the Windows resource embed.
# System.Drawing only emits single-size ICOs via Icon.Save; that's enough
# for tauri-build to satisfy embed-resource on Windows.
$bmp = New-AppIcon 256
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$icoPath = Join-Path $OutDir 'icon.ico'
$fs = [System.IO.File]::Open($icoPath, 'Create')
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp.Dispose()
Write-Host "  wrote icon.ico"

# Placeholder ICNS for macOS bundling. We do not generate a real icns here
# (would need iconutil on macOS); we write the 256x256 PNG bytes under the
# .icns name as a placeholder so tauri.conf.json validation passes. On real
# macOS builds you would replace this with a proper iconutil-built file.
$bmp = New-AppIcon 256
$bmp.Save((Join-Path $OutDir 'icon.icns'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "  wrote icon.icns (PNG placeholder)"

Write-Host ""
Write-Host "Icons generated in $OutDir"
