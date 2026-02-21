#!/bin/sh
set -e

# jin installer — downloads and installs the jin binary
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/jin/main/install.sh | sh

REPO="YOUR_ORG/jin"
INSTALL_DIR="${JIN_INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$OS" in
  linux|darwin) ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

PLATFORM="${OS}-${ARCH}"
echo "jin installer"
echo "  Platform: ${PLATFORM}"
echo "  Install to: ${INSTALL_DIR}"
echo ""

# Create install directory
mkdir -p "$INSTALL_DIR"

# Check if bun is available for building from source
if command -v bun >/dev/null 2>&1; then
  echo "  Bun found. Building from source..."
  TMPDIR=$(mktemp -d)
  cd "$TMPDIR"
  git clone --depth 1 "https://github.com/${REPO}.git" jin-src 2>/dev/null || {
    echo "  Could not clone repo. Trying GitHub release download..."
    # Fall through to release download
  }

  if [ -d "jin-src" ]; then
    cd jin-src
    bun install
    bun build ./src/index.ts --compile --outfile "$INSTALL_DIR/jin"
    rm -rf "$TMPDIR"
    echo ""
    echo "  jin installed to ${INSTALL_DIR}/jin"
    echo ""
    echo "  Run 'jin init' to get started."
    exit 0
  fi
fi

# Download pre-compiled binary from GitHub releases
LATEST_URL="https://api.github.com/repos/${REPO}/releases/latest"
echo "  Downloading latest release..."

DOWNLOAD_URL=$(curl -fsSL "$LATEST_URL" | grep "browser_download_url.*${PLATFORM}" | head -1 | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "  Error: No binary found for ${PLATFORM}"
  echo "  You can build from source: git clone the repo and run 'bun build ./src/index.ts --compile --outfile jin'"
  exit 1
fi

curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/jin"
chmod +x "$INSTALL_DIR/jin"

echo ""
echo "  jin installed to ${INSTALL_DIR}/jin"
echo ""

# Check PATH
case ":$PATH:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo "  Add ${INSTALL_DIR} to your PATH:"
    echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""
    ;;
esac

echo "  Run 'jin init' to get started."
