# Loads this working copy into Illustrator as an unsigned development extension (Windows).
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-dev-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-dev-windows.ps1 -Uninstall
#
# PlayerDebugMode lets Illustrator load unsigned extensions for this Windows user.
# Turn it off when you are done testing by deleting the PlayerDebugMode values
# under HKCU:\Software\Adobe\CSXS.11, CSXS.12 and CSXS.13.
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$Id = "com.mullion.panel"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ExtDir = Join-Path $env:APPDATA "Adobe\CEP\extensions"
$Link = Join-Path $ExtDir $Id

if ($Uninstall) {
    if (Test-Path $Link) {
        # Removing a junction deletes the link only, never the target folder.
        (Get-Item $Link).Delete()
        Write-Host "Removed $Link"
    } else {
        Write-Host "Nothing to remove at $Link"
    }
    exit 0
}

# CSXS 11 = Illustrator 2022, 12 = Illustrator 2023-2026. 13 is set for future versions.
foreach ($version in 11, 12, 13) {
    $key = "HKCU:\Software\Adobe\CSXS.$version"
    if (-not (Test-Path $key)) {
        New-Item -Path $key | Out-Null
    }
    Set-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -Type String
}

New-Item -ItemType Directory -Force -Path $ExtDir | Out-Null
if (Test-Path $Link) {
    $item = Get-Item $Link
    if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "A folder already exists at $Link and is not a link. Move it away and run this again."
    }
    $item.Delete()
}
New-Item -ItemType Junction -Path $Link -Target $Root | Out-Null

Write-Host "Linked $Link -> $Root"
Write-Host "Restart Illustrator, then open Window > Extensions > Mullion."
