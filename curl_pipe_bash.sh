#!/usr/bin/env bash

# Open Edison quick setup script
# Usage:
#   curl -L https://setup-open.edison.watch | bash

set -Eeuo pipefail

log() { printf "[setup-open-edison] %s\n" "$*"; }
err() { printf "[setup-open-edison][ERROR] %s\n" "$*" >&2; }

# Detect platform (best-effort). This script supports macOS and Linux.
OS_NAME="$(uname -s || true)"
case "$OS_NAME" in
  Darwin|Linux)
    : ;; # supported
  *)
    err "Unsupported OS: $OS_NAME"
    err "For Windows, run PowerShell as Admin and execute:"
    err "  irm https://astral.sh/uv/install.ps1 | iex"
    err "And after that, run this script again."
    exit 1
    ;;
esac

# Install uv if missing (official installer). Non-interactive.
# Note, do not export PATH for the uv bin before the uv installer,
#  because it will inhibit the uv installer from updating bashrc/zshrc
if ! PATH="$PATH:$HOME/.local/bin" command -v uv >/dev/null 2>&1; then
  log "Installing uv (Python packaging/runner) ..."
  # shellcheck disable=SC2312
  if ! curl -fsSL https://astral.sh/uv/install.sh | sh; then
    err "Failed to install uv via installer script"
    exit 1
  fi
  # Export PATH to uv bin
  export PATH="$PATH:$HOME/.local/bin"
else
  # Export PATH to uv bin
  export PATH="$PATH:$HOME/.local/bin"
  log "uv already installed: $(uv --version || echo unknown)"
fi

# Validate uv is callable now
if ! command -v "uv" >/dev/null 2>&1; then
  err "uv not found on PATH after installation. Ensure $HOME/.local/bin is in PATH."
  err "Try:  echo 'export PATH=\"$PATH:$HOME/.local/bin\"' >> ~/.bashrc && source ~/.bashrc"
  exit 1
fi

log "Using uv: $(uv --version)"

# Ensure a compatible Python is available. open-edison requires Python >= 3.12
if ! uv python find 3.12 >/dev/null 2>&1; then
  log "Installing managed Python 3.12 via uv ..."
  uv python install 3.12
fi

# Show where Python comes from (for diagnostics)
log "Managed Python: $(uv python find 3.12)"

# Run Open Edison via uvx (ephemeral, isolated environment). This will download and cache on first run.
log "Launching Open Edison (this may take a minute on first run) ..."
log "Tip: Next time, simply run:  uvx open-edison"

# Forward any args provided to this script to open-edison (e.g., --config-dir)
exec uvx open-edison "$@"


