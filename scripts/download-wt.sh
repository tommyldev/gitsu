#!/usr/bin/env bash
# download-wt.sh — fetch a pinned `wt` (worktrunk) release and stage it as
# a Tauri sidecar in `src-tauri/binaries/wt-<target-triple>`.
#
# Usage:
#   bash scripts/download-wt.sh                       # uses pinned WT_VERSION + host triple
#   WT_VERSION=0.56.0 bash scripts/download-wt.sh
#   TRIPLE=aarch64-apple-darwin bash scripts/download-wt.sh
#
# Idempotent: re-runs are no-ops if the sidecar for the current target
# already exists. Use FORCE=1 to overwrite.

set -euo pipefail

WT_VERSION="${WT_VERSION:-0.56.0}"
GITHUB_REPO="max-sixty/worktrunk"
BINARIES_DIR="src-tauri/binaries"
FORCE="${FORCE:-0}"

# Resolve target triple. Tauri expects:
#   - linux: x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu
#   - macOS: x86_64-apple-darwin,  aarch64-apple-darwin
#   - win:   x86_64-pc-windows-msvc
# Worktrunk only ships MUSL builds for Linux and a `git-wt` for Windows.
# We rename the musl artifact to the gnu triple (static-pie binary, runs
# on any Linux). Documented in `docs/WORKTRUNK_INTEGRATION.md`.

detect_host_triple() {
  local arch os
  arch="$(uname -m)"
  os="$(uname -s)"
  case "$os" in
    Linux)
      case "$arch" in
        x86_64)  echo "x86_64-unknown-linux-gnu" ;;
        aarch64) echo "aarch64-unknown-linux-gnu" ;;
        *) echo "unsupported arch: $arch" >&2; exit 1 ;;
      esac
      ;;
    Darwin)
      case "$arch" in
        x86_64)  echo "x86_64-apple-darwin" ;;
        arm64)   echo "aarch64-apple-darwin" ;;
        *) echo "unsupported arch: $arch" >&2; exit 1 ;;
      esac
      ;;
    MINGW*|CYGWIN*|MSYS*)
      echo "x86_64-pc-windows-msvc"
      ;;
    *)
      echo "unsupported OS: $os" >&2; exit 1
      ;;
  esac
}

# Map Tauri target triple → worktrunk release asset name (without
# .tar.xz / .zip). We use musl on Linux; on macOS / Windows the
# upstream asset name matches the Tauri triple.
worktrunk_asset() {
  local triple="$1"
  case "$triple" in
    x86_64-unknown-linux-gnu)  echo "worktrunk-x86_64-unknown-linux-musl" ;;
    aarch64-unknown-linux-gnu) echo "worktrunk-aarch64-unknown-linux-musl" ;;
    x86_64-apple-darwin)       echo "worktrunk-x86_64-apple-darwin" ;;
    aarch64-apple-darwin)      echo "worktrunk-aarch64-apple-darwin" ;;
    x86_64-pc-windows-msvc)    echo "worktrunk-x86_64-pc-windows-msvc" ;;
    *) echo "unknown triple: $triple" >&2; exit 1 ;;
  esac
}

TRIPLE="${TRIPLE:-$(detect_host_triple)}"
ASSET_BASE="$(worktrunk_asset "$TRIPLE")"
SIDECAR="$BINARIES_DIR/wt-${TRIPLE}$(uname -s | grep -q MINGW && echo .exe || true)"

if [[ -f "$SIDECAR" && "$FORCE" != "1" ]]; then
  echo "✓ $SIDECAR already present (FORCE=1 to overwrite)"
  "$SIDECAR" --version || true
  exit 0
fi

mkdir -p "$BINARIES_DIR"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Pick the archive extension by triple
case "$TRIPLE" in
  *-pc-windows-msvc) ARCHIVE_EXT="zip" ;;
  *)                 ARCHIVE_EXT="tar.xz" ;;
esac

ARCHIVE="$WORKDIR/$ASSET_BASE.$ARCHIVE_EXT"
URL="https://github.com/${GITHUB_REPO}/releases/download/v${WT_VERSION}/${ASSET_BASE}.${ARCHIVE_EXT}"

echo "→ Downloading $URL"
curl --fail --location --silent --show-error --output "$ARCHIVE" "$URL"

echo "→ Verifying SHA-256"
SHA_URL="https://github.com/${GITHUB_REPO}/releases/download/v${WT_VERSION}/${ASSET_BASE}.${ARCHIVE_EXT}.sha256"
SHA_FILE="$WORKDIR/${ASSET_BASE}.sha256"
curl --fail --location --silent --show-error --output "$SHA_FILE" "$SHA_URL"
EXPECTED="$(cat "$SHA_FILE" | awk '{print $1}')"
ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "✗ SHA-256 mismatch" >&2
  echo "  expected: $EXPECTED" >&2
  echo "  actual:   $ACTUAL"   >&2
  exit 1
fi

echo "→ Extracting"
case "$ARCHIVE_EXT" in
  zip)
    unzip -q "$ARCHIVE" -d "$WORKDIR/extract"
    BINARY="$WORKDIR/extract/${ASSET_BASE}/wt.exe"
    ;;
  *)
    mkdir -p "$WORKDIR/extract"
    tar -xJf "$ARCHIVE" -C "$WORKDIR/extract"
    BINARY="$WORKDIR/extract/${ASSET_BASE}/wt"
    ;;
esac

[[ -f "$BINARY" ]] || { echo "✗ wt binary not found after extraction" >&2; exit 1; }

cp "$BINARY" "$SIDECAR"
chmod +x "$SIDECAR"

echo "✓ Installed $SIDECAR"
"$SIDECAR" --version
