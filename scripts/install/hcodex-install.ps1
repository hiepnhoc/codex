# Install or update hcodex (Windows x64) from the GitHub Releases of hiepnhoc/codex.
#
#   irm https://github.com/hiepnhoc/codex/releases/latest/download/install.ps1 | iex
#
#   $env:HCODEX_RELEASE = "0.1.0"      install a specific version instead of latest
#   $env:HCODEX_INSTALL_DIR = "..."    where the binaries go (default %USERPROFILE%\.hcodex\bin)
#
# Binaries land in %USERPROFILE%\.hcodex\bin, which is added to the user PATH.
# The previous binaries are kept in %USERPROFILE%\.hcodex\backup. Works in
# Windows PowerShell 5.1 and PowerShell 7.
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = "hiepnhoc/codex"
$Release = if ([string]::IsNullOrWhiteSpace($env:HCODEX_RELEASE)) { "latest" } else { $env:HCODEX_RELEASE }
$HcodexHome = Join-Path $env:USERPROFILE ".hcodex"
$InstallDir = if ([string]::IsNullOrWhiteSpace($env:HCODEX_INSTALL_DIR)) { Join-Path $HcodexHome "bin" } else { $env:HCODEX_INSTALL_DIR }
$BackupDir = Join-Path $HcodexHome "backup"
$Binaries = @("hcodex", "codex-code-mode-host", "codex-windows-sandbox-setup", "codex-windows-sandbox-service", "codex-command-runner")

function Step([string]$Message) { Write-Host "==> $Message" }

$arch = $env:PROCESSOR_ARCHITEW6432
if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
switch ($arch) {
    "AMD64" { $Target = "x86_64-pc-windows-msvc" }
    "ARM64" { throw "no hcodex build for Windows ARM64 yet; build from source (HCODEX.md)" }
    default { throw "unsupported architecture $arch" }
}

$Asset = "hcodex-$Target.zip"
if ($Release -eq "latest") {
    $Base = "https://github.com/$Repo/releases/latest/download"
} elseif ($Release.StartsWith("hcodex-v")) {
    $Base = "https://github.com/$Repo/releases/download/$Release"
} else {
    $Base = "https://github.com/$Repo/releases/download/hcodex-v$($Release.TrimStart('v'))"
}

$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("hcodex-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
    Step "download $Base/$Asset"
    $ZipPath = Join-Path $Tmp $Asset
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset" -OutFile $ZipPath
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset.sha256" -OutFile "$ZipPath.sha256"

    Step "verify checksum"
    $Expected = ((Get-Content -LiteralPath "$ZipPath.sha256" -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $Actual = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Expected -ne $Actual) { throw "sha256 mismatch: expected $Expected got $Actual" }

    Step "extract"
    $Extract = Join-Path $Tmp "x"
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $Extract -Force
    foreach ($b in $Binaries) {
        if (-not (Test-Path -LiteralPath (Join-Path $Extract "$b.exe"))) { throw "archive is missing $b.exe" }
    }
    $NewVersion = (& (Join-Path $Extract "hcodex.exe") --version 2>$null | Out-String).Trim()
    if (-not $NewVersion) { throw "downloaded hcodex.exe does not run" }

    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

    # Leftovers from a previous update (an .old is a renamed, then-running exe).
    Get-ChildItem -LiteralPath $InstallDir -Filter "*.old" -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    }

    $CurrentExe = Join-Path $InstallDir "hcodex.exe"
    if (Test-Path -LiteralPath $CurrentExe) {
        $OldVersion = try { (& $CurrentExe --version 2>$null | Out-String).Trim() } catch { "unknown" }
        Step "backup current ($OldVersion) -> $BackupDir"
        New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
        foreach ($b in $Binaries) {
            $src = Join-Path $InstallDir "$b.exe"
            if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $BackupDir "$b.exe") -Force }
        }
    }

    Step "install -> $InstallDir"
    foreach ($b in $Binaries) {
        $dest = Join-Path $InstallDir "$b.exe"
        if (Test-Path -LiteralPath $dest) {
            # A running exe cannot be overwritten but can be renamed; this is
            # what happens when hcodex itself launches the update.
            Move-Item -LiteralPath $dest -Destination "$dest.old" -Force
        }
        Move-Item -LiteralPath (Join-Path $Extract "$b.exe") -Destination $dest -Force
    }
    Get-ChildItem -LiteralPath $InstallDir -Filter "*.old" -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    }
    Get-ChildItem -LiteralPath $HcodexHome -Filter "models_cache*.json" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

    # User PATH (persistent) + this session.
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $segments = @()
    if ($UserPath) { $segments = $UserPath.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries) }
    $onPath = $false
    foreach ($s in $segments) { if ($s.TrimEnd('\') -ieq $InstallDir.TrimEnd('\')) { $onPath = $true } }
    if (-not $onPath) {
        [Environment]::SetEnvironmentVariable("Path", (($segments + $InstallDir) -join ";"), "User")
        Step "added $InstallDir to the user PATH (open a new terminal to pick it up)"
    }
    if (-not (($env:Path -split ";") -contains $InstallDir)) { $env:Path = "$InstallDir;$env:Path" }

    Step "installed $NewVersion"
    Write-Host "    $CurrentExe"
    Write-Host "    hooks and scripts of the harness are bash: install Git for Windows so 'bash' is on PATH."
} finally {
    Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}
