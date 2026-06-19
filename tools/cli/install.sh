#!/usr/bin/env bash
set -euo pipefail

MAMMOTH_VERSION="${MAMMOTH_VERSION:-latest}"
NODE_MIN_MAJOR=20

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; WHITE='\033[1;37m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}  [ok]${RESET}  $1"; }
warn() { echo -e "${YELLOW}  [!]${RESET}   $1"; }
err()  { echo -e "${RED}  [x]${RESET}   $1"; exit 1; }
info() { echo -e "${CYAN}  -->  ${RESET}$1"; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${WHITE}  MAMMOTH Installer${RESET}"
echo -e "  ${CYAN}AI Company OS — https://mammoth.run${RESET}"
echo ""

# ── OS detection ──────────────────────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
  Linux*)  PLATFORM=linux  ;;
  Darwin*) PLATFORM=mac    ;;
  *)       err "Unsupported OS: $OS. Install manually: npm i -g mammoth" ;;
esac

# ── Node.js check / install ───────────────────────────────────────────────────
install_node_mac() {
  if command -v brew &>/dev/null; then
    info "Installing Node.js via Homebrew..."
    brew install node@20
    brew link node@20 --force --overwrite 2>/dev/null || true
  else
    info "Installing nvm to manage Node.js..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    # shellcheck disable=SC1090
    source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
    nvm install 20 && nvm use 20
  fi
}

install_node_linux() {
  if command -v apt-get &>/dev/null; then
    info "Installing Node.js 20 via apt..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf &>/dev/null; then
    info "Installing Node.js 20 via dnf..."
    sudo dnf module install -y nodejs:20
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
  else
    err "Cannot auto-install Node.js on this Linux. Install manually: https://nodejs.org"
  fi
}

if command -v node &>/dev/null; then
  NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
  if [ "$NODE_MAJOR" -lt "$NODE_MIN_MAJOR" ]; then
    warn "Node.js $NODE_MAJOR found, need $NODE_MIN_MAJOR+. Upgrading..."
    [ "$PLATFORM" = "mac" ] && install_node_mac || install_node_linux
  else
    ok "Node.js $(node --version)"
  fi
else
  info "Node.js not found. Installing..."
  [ "$PLATFORM" = "mac" ] && install_node_mac || install_node_linux
fi

# Verify node available now
if ! command -v node &>/dev/null; then
  err "Node.js installation failed. Install manually: https://nodejs.org"
fi
ok "Node.js $(node --version)"

# ── Docker check ──────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo ""
  warn "Docker is not installed."
  echo ""
  if [ "$PLATFORM" = "mac" ]; then
    echo "  Install Docker Desktop for Mac:"
    echo "  https://docs.docker.com/desktop/install/mac-install/"
  else
    echo "  Install Docker Desktop for Linux:"
    echo "  https://docs.docker.com/desktop/install/linux-install/"
  fi
  echo ""
  echo "  After installing Docker, run:"
  echo "  npm i -g mammoth && mammoth init"
  echo ""
  exit 0
fi

if ! docker info &>/dev/null 2>&1; then
  warn "Docker is installed but not running. Start Docker Desktop and retry."
  exit 0
fi
ok "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)"

# ── Install MAMMOTH CLI ───────────────────────────────────────────────────────
echo ""
info "Installing MAMMOTH CLI..."
npm install -g "mammoth@${MAMMOTH_VERSION}" 2>&1 | tail -3
ok "mammoth CLI installed"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${WHITE}  Ready. Run setup:${RESET}"
echo ""
echo -e "  ${CYAN}\$ mammoth init${RESET}"
echo ""
