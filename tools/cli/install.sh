#!/usr/bin/env bash
# MAMMOTH Installer — Mac and Linux
# https://mammoth.run
#
# Usage: curl -fsSL https://mammoth.run/install | bash
#
# What this does, in order:
#   1. Detects OS (macOS or Linux distro)
#   2. Installs Node.js 20+ if missing
#   3. Installs a container runtime (OrbStack on Mac, Docker Engine on Linux)
#   4. npm install -g mammoth
#   5. mammoth init

set -euo pipefail
IFS=$'\n\t'

# ── Terminal colors ───────────────────────────────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; BOLD=''; DIM=''; RESET=''
fi

step()    { echo -e "\n${BOLD}${CYAN}==> $1${RESET}"; }
ok()      { echo -e "    ${GREEN}✓${RESET}  $1"; }
warn()    { echo -e "    ${YELLOW}!${RESET}  $1"; }
info()    { echo -e "    ${DIM}$1${RESET}"; }
die()     { echo -e "\n    ${RED}Error:${RESET} $1\n"; exit 1; }
confirm() {
  echo -e "\n    ${YELLOW}$1${RESET}"
  read -r -p "    Continue? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }
}

# ── Banner ────────────────────────────────────────────────────────────────────
clear 2>/dev/null || true
echo ""
echo -e "${BOLD}    MAMMOTH — AI Company OS${RESET}"
echo -e "    ${DIM}https://mammoth.run${RESET}"
echo ""
echo -e "    This installer will set up everything on your machine:"
echo -e "    ${DIM}Node.js, container runtime, and the mammoth CLI.${RESET}"
echo ""

# ── OS detection ──────────────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    PLATFORM="mac"
    MACOS_VERSION="$(sw_vers -productVersion)"
    MACOS_MAJOR="$(echo "$MACOS_VERSION" | cut -d. -f1)"
    if [ "$MACOS_MAJOR" -lt 12 ]; then
      die "macOS 12 (Monterey) or later is required. Your version: $MACOS_VERSION"
    fi
    ;;
  Linux)
    PLATFORM="linux"
    if [ -f /etc/os-release ]; then
      # shellcheck disable=SC1091
      . /etc/os-release
      DISTRO="${ID:-unknown}"
    else
      die "Cannot detect Linux distribution."
    fi
    ;;
  *)
    die "Unsupported OS: $OS. Use the Windows installer instead:\n    https://mammoth.run/install-windows"
    ;;
esac

# ── Homebrew (Mac only) ───────────────────────────────────────────────────────
install_homebrew() {
  if command -v brew &>/dev/null; then
    ok "Homebrew already installed"
    return
  fi
  step "Installing Homebrew (Mac package manager)"
  info "This will prompt for your Mac password once."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  # Add brew to PATH for Apple Silicon
  if [ "$ARCH" = "arm64" ] && [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  fi
  ok "Homebrew installed"
}

# ── Node.js ───────────────────────────────────────────────────────────────────
NODE_MIN=20

install_node_mac() {
  step "Installing Node.js $NODE_MIN"
  brew install node@20
  brew link node@20 --force --overwrite 2>/dev/null || true
  ok "Node.js $(node --version) installed"
}

install_node_linux_debian() {
  step "Installing Node.js $NODE_MIN (via NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1 | grep -v "^$" | tail -3
  sudo apt-get install -y nodejs 2>&1 | tail -3
  ok "Node.js $(node --version) installed"
}

install_node_linux_rhel() {
  step "Installing Node.js $NODE_MIN (via NodeSource)"
  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - 2>&1 | tail -3
  sudo yum install -y nodejs 2>&1 | tail -3
  ok "Node.js $(node --version) installed"
}

install_node_linux_arch() {
  step "Installing Node.js $NODE_MIN"
  sudo pacman -S --noconfirm nodejs npm 2>&1 | tail -3
  ok "Node.js $(node --version) installed"
}

check_or_install_node() {
  if command -v node &>/dev/null; then
    NODE_MAJOR="$(node -e "process.stdout.write(process.versions.node.split('.')[0])")"
    if [ "$NODE_MAJOR" -ge "$NODE_MIN" ]; then
      ok "Node.js $(node --version) (already installed)"
      return
    fi
    warn "Node.js $NODE_MAJOR found — need $NODE_MIN+. Upgrading..."
  fi

  case "$PLATFORM" in
    mac) install_node_mac ;;
    linux)
      case "${DISTRO:-}" in
        ubuntu|debian|linuxmint|pop) install_node_linux_debian ;;
        fedora|rhel|centos|rocky|almalinux) install_node_linux_rhel ;;
        arch|manjaro) install_node_linux_arch ;;
        *)
          die "Cannot auto-install Node.js on '$DISTRO'. Install manually:\n    https://nodejs.org/en/download\n    Then re-run: curl -fsSL https://mammoth.run/install | bash"
          ;;
      esac
      ;;
  esac
}

# ── Container runtime ─────────────────────────────────────────────────────────
#
# Mac: OrbStack — runs Docker in the background, zero configuration needed.
#      Much lighter than Docker Desktop (20x less RAM, starts in 2 seconds).
#      Personal use is free.
#
# Linux: Docker Engine — official Docker on Linux, no GUI required.

install_orbstack_mac() {
  if command -v orb &>/dev/null || [ -d "/Applications/OrbStack.app" ]; then
    ok "OrbStack already installed"
  else
    step "Installing OrbStack (container runtime)"
    info "OrbStack runs Docker containers in the background — no configuration needed."
    brew install orbstack
    # Start OrbStack so Docker daemon is available immediately
    open -a OrbStack 2>/dev/null || true
    ok "OrbStack installed"
  fi

  # Wait for Docker daemon
  info "Starting container daemon..."
  local attempts=0
  until docker info &>/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ $attempts -gt 20 ]; then
      die "Container daemon did not start within 40 seconds.\n    Open OrbStack manually and re-run: mammoth init"
    fi
    sleep 2
  done
  ok "Container daemon ready"
}

install_docker_linux() {
  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    ok "Docker already running"
    return
  fi

  step "Installing Docker Engine"
  info "This will ask for your password (sudo) to install system packages."

  case "${DISTRO:-}" in
    ubuntu|debian|linuxmint|pop)
      sudo apt-get update -qq
      sudo apt-get install -y ca-certificates curl gnupg lsb-release
      sudo install -m 0755 -d /etc/apt/keyrings
      curl -fsSL https://download.docker.com/linux/"${DISTRO}"/gpg | \
        sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
      sudo chmod a+r /etc/apt/keyrings/docker.gpg
      echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/${DISTRO} $(lsb_release -cs) stable" | \
        sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
      sudo apt-get update -qq
      sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    fedora|rhel|centos|rocky|almalinux)
      sudo dnf -y install dnf-plugins-core
      sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
      sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    *)
      die "Cannot auto-install Docker on '$DISTRO'.\n    Install manually: https://docs.docker.com/engine/install\n    Then re-run: mammoth init"
      ;;
  esac

  sudo systemctl enable --now docker 2>/dev/null || true
  # Add current user to docker group so mammoth runs without sudo
  sudo usermod -aG docker "$USER" 2>/dev/null || true
  ok "Docker Engine installed"
  info "You may need to log out and log back in for group permissions to apply."
  info "If mammoth start fails, run: newgrp docker"
}

check_or_install_runtime() {
  case "$PLATFORM" in
    mac)   install_orbstack_mac ;;
    linux) install_docker_linux ;;
  esac
}

# ── mammoth CLI ───────────────────────────────────────────────────────────────
install_mammoth_cli() {
  step "Installing MAMMOTH CLI"
  npm install -g mammoth --silent
  ok "mammoth $(mammoth --version 2>/dev/null || echo 'installed')"
}

# ── Main ──────────────────────────────────────────────────────────────────────
confirm "This installer will make changes to your machine. Review what it does:\n    https://github.com/yourname/mammoth/blob/main/tools/cli/install.sh"

check_or_install_node
check_or_install_runtime
install_homebrew 2>/dev/null || true  # Mac only, safe to skip if already done
install_mammoth_cli

echo ""
echo -e "${BOLD}    MAMMOTH installed.${RESET}"
echo ""
echo -e "    Run setup now:"
echo -e "    ${CYAN}    mammoth init${RESET}"
echo ""

mammoth init
