#!/bin/bash
set -e

# Claude-LK Installer
# Usage: curl -fsSL https://tu-dominio.com/install.sh | bash

REPO="jordi-zaragoza/latent-k-releases"
VERSION="v1.1.0"
INSTALL_DIR="/usr/local/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Detect OS and architecture
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Linux*)  os="linux" ;;
        Darwin*) os="macos" ;;
        MINGW*|MSYS*|CYGWIN*) os="win" ;;
        *) error "Unsupported OS: $(uname -s)" ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x64" ;;
        arm64|aarch64) arch="arm64" ;;
        *) error "Unsupported architecture: $(uname -m)" ;;
    esac

    echo "${os}"
}

# Get download URL
get_download_url() {
    local os="$1"
    local base_url="https://github.com/${REPO}/releases/download/${VERSION}"

    case "$os" in
        linux) echo "${base_url}/lk-linux" ;;
        macos) echo "${base_url}/lk-macos" ;;
        win)   echo "${base_url}/lk-win.exe" ;;
    esac
}

# Main installation
main() {
    echo ""
    echo "  Claude-LK Installer"
    echo "  ==================="
    echo ""

    # Detect platform
    local platform=$(detect_platform)
    info "Detected platform: ${platform}"

    # Get download URL
    local url=$(get_download_url "$platform")
    info "Downloading from: ${url}"

    # Create temp file
    local tmp_file=$(mktemp)
    trap "rm -f ${tmp_file}" EXIT

    # Download
    if command -v curl &> /dev/null; then
        curl -fsSL "$url" -o "$tmp_file"
    elif command -v wget &> /dev/null; then
        wget -q "$url" -O "$tmp_file"
    else
        error "curl or wget required"
    fi

    # Install
    local bin_name="lk"
    [[ "$platform" == "win" ]] && bin_name="lk.exe"

    chmod +x "$tmp_file"

    if [[ -w "$INSTALL_DIR" ]]; then
        mv "$tmp_file" "${INSTALL_DIR}/${bin_name}"
    else
        info "Need sudo to install to ${INSTALL_DIR}"
        sudo mv "$tmp_file" "${INSTALL_DIR}/${bin_name}"
    fi

    info "Installed to ${INSTALL_DIR}/${bin_name}"
    echo ""
    echo -e "${GREEN}Installation complete!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run: lk activate"
    echo "  2. Add to Claude Code settings.json:"
    echo ""
    echo '     "mcpServers": {'
    echo '       "lk": {'
    echo '         "command": "lk",'
    echo '         "args": ["serve"]'
    echo '       }'
    echo '     }'
    echo ""
}

main "$@"
