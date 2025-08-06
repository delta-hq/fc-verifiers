#!/bin/bash

# Build OpenCode for terminal-bench
# This script builds OpenCode binaries for both local testing and Docker containers

cd "$(dirname "$0")/opencode"

echo "Installing dependencies..."
bun install

echo "Building OpenCode for local development (macOS)..."
bun build ./packages/opencode/bin/opencode --compile --outfile opencode-custom-macos

echo "Building OpenCode for Docker containers (Linux ARM64)..."
bun build ./packages/opencode/bin/opencode --compile --target=bun-linux-arm64 --outfile opencode-custom

echo "Build complete!"
echo "- Local binary: opencode-custom-macos"
echo "- Docker binary: opencode-custom"