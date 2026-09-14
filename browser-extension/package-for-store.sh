#!/bin/bash
# Use the same ZIP writer and validation on Windows, macOS, Linux and in tests.
set -e
node "$(dirname "$0")/../scripts/package-extension.js" "$@"
