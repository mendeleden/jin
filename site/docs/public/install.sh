#!/bin/sh
set -e

# jin installer
# Usage: curl -fsSL https://raw.githubusercontent.com/mendeleden/jin/main/install.sh | sh

REPO="mendeleden/jin"
INSTALL_DIR="${JIN_INSTALL_DIR:-$HOME/.local/bin}"
ARTIFACT_NAME="jin"

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

ARTIFACT_NAME="jin-${OS}-${ARCH}"

echo "jin installer"
echo "  Platform: ${OS}-${ARCH}"
echo "  Install to: ${INSTALL_DIR}"
echo ""

mkdir -p "$INSTALL_DIR"

# Try downloading pre-built binary from latest GitHub release
LATEST_URL="https://api.github.com/repos/${REPO}/releases/latest"
DOWNLOAD_URL=""

if command -v curl >/dev/null 2>&1; then
  DOWNLOAD_URL=$(curl -fsSL "$LATEST_URL" 2>/dev/null | grep "browser_download_url.*${ARTIFACT_NAME}" | head -1 | cut -d '"' -f 4) || true
fi

if [ -n "$DOWNLOAD_URL" ]; then
  echo "  Downloading ${ARTIFACT_NAME}..."
  curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/jin"
  chmod +x "$INSTALL_DIR/jin"
else
  # No release binary — fall back to building from source
  if ! command -v bun >/dev/null 2>&1; then
    echo "  No pre-built binary available and bun is not installed."
    echo ""
    echo "  Install bun first:  curl -fsSL https://bun.sh/install | bash"
    echo "  Then re-run this installer."
    exit 1
  fi

  echo "  No release binary found. Building from source..."
  TMPDIR=$(mktemp -d)
  git clone --depth 1 "https://github.com/${REPO}.git" "$TMPDIR/jin-src" 2>/dev/null
  cd "$TMPDIR/jin-src"
  bun install
  bun build ./src/index.ts --compile --outfile "$INSTALL_DIR/jin"
  rm -rf "$TMPDIR"
fi

echo ""
echo "  jin installed to ${INSTALL_DIR}/jin"

# Verify
if "$INSTALL_DIR/jin" version >/dev/null 2>&1; then
  echo "  Version: $("$INSTALL_DIR/jin" version)"
fi

echo ""

# Check PATH
case ":$PATH:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo "  Add to your PATH (add to ~/.bashrc or ~/.zshrc):"
    echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""
    ;;
esac

echo "  Get started:"
echo "    jin init          # detect your coding tools"
echo "    jin watch --daemon  # start background monitoring"
echo "    jin update        # self-update to latest version"
