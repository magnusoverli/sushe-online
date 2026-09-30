#!/usr/bin/env bash
# Run host-side tools using SuShe's isolated, version-pinned Node/npm pair.
# First use: bash scripts/with-node.sh --install
# Thereafter: bash scripts/with-node.sh npm run lint:strict
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(cat "$root/.node-version")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid .node-version' >&2; exit 1; }
[[ "$(uname -s)" == Linux ]] || { echo 'Use .node-version with your Node manager on non-Linux hosts.' >&2; exit 1; }
case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64) arch=arm64 ;;
  *) echo 'Unsupported Node architecture' >&2; exit 1 ;;
esac
name="node-v$version-linux-$arch"
base="${XDG_DATA_HOME:-$HOME/.local/share}/sushe/toolchains"
runtime="$base/$name"

if [[ "${1:-}" == --install && ! -x "$runtime/bin/node" ]]; then
  mkdir -p "$base"
  staging="$(mktemp -d "$base/.install.XXXXXX")"
  trap 'rm -rf "$staging"' EXIT
  url="https://nodejs.org/dist/v$version"
  curl --fail --silent --show-error --location "$url/$name.tar.xz" -o "$staging/$name.tar.xz"
  curl --fail --silent --show-error --location "$url/SHASUMS256.txt" -o "$staging/SHASUMS256.txt"
  (cd "$staging"; awk -v file="$name.tar.xz" '$2 == file' SHASUMS256.txt | sha256sum --check --strict -)
  mkdir "$staging/runtime"
  tar -xJf "$staging/$name.tar.xz" --strip-components=1 -C "$staging/runtime"
  mv "$staging/runtime" "$runtime"
fi

if [[ ! -x "$runtime/bin/node" ]]; then
  echo 'Install the project toolchain: bash scripts/with-node.sh --install' >&2
  exit 1
fi
export PATH="$runtime/bin:$PATH"
cd "$root"
npm_version="$(node -p 'require("./package.json").packageManager.replace(/^npm@/, "")')"
[[ "$npm_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid npm version' >&2; exit 1; }
if [[ "${1:-}" == --install ]]; then
  if [[ "$(npm --version)" != "$npm_version" ]]; then
    npm install --global --prefix "$runtime" "npm@$npm_version" --no-audit --no-fund
  fi
  node --version
  npm --version
  exit 0
fi
if [[ "$(node --version)" != "v$version" || "$(npm --version)" != "$npm_version" ]]; then
  echo 'Toolchain versions differ; rerun: bash scripts/with-node.sh --install' >&2
  exit 1
fi
[[ $# -gt 0 ]] || { echo 'Usage: bash scripts/with-node.sh <command> [args...]' >&2; exit 1; }
exec "$@"
