# MAMMOTH Installer — Windows
# https://mammoth.run
#
# Usage (PowerShell as Administrator):
#   irm https://mammoth.run/install.ps1 | iex
#
# What this does, in order:
#   1. Verifies Windows 10/11 with winget available
#   2. Installs Node.js 20 LTS via winget
#   3. Installs Docker Desktop via winget (requires WSL2 + restart)
#   4. npm install -g mammoth
#   5. mammoth init

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Colors ────────────────────────────────────────────────────────────────────
function Write-Step   { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok     { param($msg) Write-Host "    [ok]  $msg" -ForegroundColor Green }
function Write-Warn   { param($msg) Write-Host "    [!]   $msg" -ForegroundColor Yellow }
function Write-Info   { param($msg) Write-Host "          $msg" -ForegroundColor DarkGray }
function Write-Fail   { param($msg) Write-Host "`n    [x]   $msg`n" -ForegroundColor Red; exit 1 }

# ── Banner ────────────────────────────────────────────────────────────────────
Clear-Host
Write-Host ""
Write-Host "    MAMMOTH - AI Company OS" -ForegroundColor White -BackgroundColor Black
Write-Host "    https://mammoth.run" -ForegroundColor DarkGray
Write-Host ""
Write-Host "    This installer will set up on your machine:"
Write-Host "    Node.js, Docker Desktop, and the mammoth CLI." -ForegroundColor DarkGray
Write-Host ""

$confirm = Read-Host "    Continue? [y/N]"
if ($confirm -notmatch "^[Yy]$") { Write-Host "Cancelled."; exit 0 }

# ── Windows version check ─────────────────────────────────────────────────────
Write-Step "Checking Windows version"
$winVer = [System.Environment]::OSVersion.Version
if ($winVer.Major -lt 10) {
    Write-Fail "Windows 10 or later is required. Your version: $($winVer.ToString())"
}
Write-Ok "Windows $($winVer.Major).$($winVer.Minor) detected"

# ── Admin check ───────────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Warn "Not running as Administrator."
    Write-Info "Some installations may fail without admin rights."
    Write-Info "For best results, open PowerShell as Administrator and re-run:"
    Write-Info "    irm https://mammoth.run/install.ps1 | iex"
    $continue = Read-Host "    Continue anyway? [y/N]"
    if ($continue -notmatch "^[Yy]$") { exit 0 }
}

# ── winget check ─────────────────────────────────────────────────────────────
Write-Step "Checking package manager (winget)"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Warn "winget not found."
    Write-Info "winget comes with Windows 10 2004+ and Windows 11."
    Write-Info "Install it from the Microsoft Store: App Installer"
    Write-Info "    https://apps.microsoft.com/store/detail/app-installer/9NBLGGH4NNS1"
    Write-Info ""
    Write-Info "Or install Node.js and Docker manually:"
    Write-Info "    Node.js:  https://nodejs.org"
    Write-Info "    Docker:   https://docs.docker.com/desktop/install/windows-install/"
    Write-Info ""
    Write-Info "Then run: npm install -g mammoth && mammoth init"
    exit 1
}
Write-Ok "winget available"

# ── Node.js ───────────────────────────────────────────────────────────────────
Write-Step "Checking Node.js"

$nodeInstalled = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node -e "process.stdout.write(process.versions.node)" 2>$null
    $nodeMajor = [int]($nodeVersion -split "\.")[0]
    if ($nodeMajor -ge 20) {
        Write-Ok "Node.js v$nodeVersion (already installed)"
        $nodeInstalled = $true
    } else {
        Write-Warn "Node.js $nodeVersion found — need 20+. Upgrading..."
    }
}

if (-not $nodeInstalled) {
    Write-Info "Installing Node.js 20 LTS..."
    winget install --id OpenJS.NodeJS.LTS --version 20 --silent --accept-source-agreements --accept-package-agreements
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (Get-Command node -ErrorAction SilentlyContinue) {
        Write-Ok "Node.js $(node --version) installed"
    } else {
        Write-Warn "Node.js installed but not in PATH yet."
        Write-Info "Close this window, open a new PowerShell, and run: mammoth init"
    }
}

# ── Docker Desktop ────────────────────────────────────────────────────────────
Write-Step "Checking Docker"

$dockerRunning = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    try {
        docker info 2>$null | Out-Null
        Write-Ok "Docker is running"
        $dockerRunning = $true
    } catch {
        Write-Warn "Docker is installed but not running. Start Docker Desktop first."
    }
}

if (-not $dockerRunning) {
    Write-Info "Installing Docker Desktop..."
    Write-Info "This will download ~600MB. This may take several minutes."
    Write-Info ""

    # Check WSL2 first — Docker Desktop requires it
    $wslFeature = Get-WindowsOptionalFeature -Online -FeatureName "Microsoft-Windows-Subsystem-Linux" -ErrorAction SilentlyContinue
    if ($wslFeature.State -ne "Enabled") {
        Write-Step "Enabling WSL2 (required for Docker)"
        Write-Warn "This requires a system restart."
        Write-Info "After restart, re-run: irm https://mammoth.run/install.ps1 | iex"
        $wslConfirm = Read-Host "    Enable WSL2 and restart now? [y/N]"
        if ($wslConfirm -match "^[Yy]$") {
            Enable-WindowsOptionalFeature -Online -FeatureName "Microsoft-Windows-Subsystem-Linux" -All -NoRestart | Out-Null
            Enable-WindowsOptionalFeature -Online -FeatureName "VirtualMachinePlatform" -All -NoRestart | Out-Null
            Write-Info "WSL2 features enabled. Restarting in 10 seconds..."
            Start-Sleep -Seconds 10
            Restart-Computer -Force
        } else {
            Write-Info "Enable WSL2 manually, then re-run the installer."
            exit 0
        }
    }

    winget install --id Docker.DockerDesktop --silent --accept-source-agreements --accept-package-agreements

    Write-Ok "Docker Desktop installed"
    Write-Warn "You need to START Docker Desktop before running mammoth init."
    Write-Info ""
    Write-Info "1. Open Docker Desktop from your Start menu"
    Write-Info "2. Wait for it to say 'Docker is running'"
    Write-Info "3. Then run: mammoth init"
    Write-Info ""

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# ── mammoth CLI ───────────────────────────────────────────────────────────────
Write-Step "Installing MAMMOTH CLI"

try {
    npm install -g mammoth --silent
    Write-Ok "mammoth CLI installed"
} catch {
    Write-Fail "npm install failed: $($_.Exception.Message)"
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "    MAMMOTH installed." -ForegroundColor Green
Write-Host ""

if ($dockerRunning) {
    Write-Host "    Run setup now:" -ForegroundColor White
    Write-Host ""
    Write-Host "        mammoth init" -ForegroundColor Cyan
    Write-Host ""
    mammoth init
} else {
    Write-Host "    Next steps:" -ForegroundColor White
    Write-Host ""
    Write-Host "    1. Open Docker Desktop from your Start menu" -ForegroundColor DarkGray
    Write-Host "    2. Wait for 'Docker is running'" -ForegroundColor DarkGray
    Write-Host "    3. Open PowerShell and run:" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "           mammoth init" -ForegroundColor Cyan
    Write-Host ""
}
