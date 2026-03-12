#!/usr/bin/env pwsh
# jin installer for Windows
# Usage: irm https://raw.githubusercontent.com/mendeleden/jin/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "mendeleden/jin"
$InstallDir = if ($env:JIN_INSTALL_DIR) { $env:JIN_INSTALL_DIR } else { Join-Path $HOME ".local\bin" }

# Detect architecture
$Arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq "Arm64") { "arm64" } else { "x64" }
$ArtifactName = "jin-windows-$Arch.exe"

Write-Host ""
Write-Host "  jin installer"
Write-Host "  Platform: windows-$Arch"
Write-Host "  Install to: $InstallDir"
Write-Host ""

# Create install directory
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Try downloading pre-built binary from latest GitHub release
$LatestUrl = "https://api.github.com/repos/$Repo/releases/latest"
$DownloadUrl = $null

try {
    $Release = Invoke-RestMethod -Uri $LatestUrl -Headers @{ "User-Agent" = "jin-installer" }
    $Asset = $Release.assets | Where-Object { $_.name -eq $ArtifactName } | Select-Object -First 1
    if ($Asset) {
        $DownloadUrl = $Asset.browser_download_url
    }
} catch {}

$JinPath = Join-Path $InstallDir "jin.exe"

if ($DownloadUrl) {
    Write-Host "  Downloading $ArtifactName..."
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $JinPath -UseBasicParsing
} else {
    # Fall back to building from source
    if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
        Write-Host "  No pre-built binary available and bun is not installed."
        Write-Host ""
        Write-Host "  Install bun first:  irm bun.sh/install.ps1 | iex"
        Write-Host "  Then re-run this installer."
        exit 1
    }

    Write-Host "  No release binary found. Building from source..."
    $TmpDir = Join-Path ([System.IO.Path]::GetTempPath()) "jin-build-$(Get-Random)"
    git clone --depth 1 "https://github.com/$Repo.git" $TmpDir 2>$null
    Push-Location $TmpDir
    bun install
    bun build ./src/index.ts --compile --outfile $JinPath
    Pop-Location
    Remove-Item -Recurse -Force $TmpDir
}

Write-Host ""
Write-Host "  jin installed to $JinPath"

# Verify
try {
    $Version = & $JinPath version 2>$null
    if ($Version) {
        Write-Host "  Version: $Version"
    }
} catch {}

Write-Host ""

# Add to user PATH if not already there
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$UserPath", "User")
    $env:Path = "$InstallDir;$env:Path"
    Write-Host "  Added $InstallDir to your PATH."
    Write-Host "  Restart your terminal for PATH changes to take effect."
} else {
    Write-Host "  $InstallDir is already in your PATH."
}

Write-Host ""
Write-Host "  Get started:"
Write-Host "    jin init            # detect your coding tools"
Write-Host "    jin start           # start background monitoring"
Write-Host "    jin update          # self-update to latest version"
Write-Host ""
