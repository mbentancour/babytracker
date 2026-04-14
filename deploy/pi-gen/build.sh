#!/bin/bash
# Build a BabyTracker Raspberry Pi image using pi-gen.
# Requires Docker to be running.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
STAGE_DIR="${SCRIPT_DIR}/stage-babytracker"
PI_GEN_DIR="/tmp/pi-gen-babytracker"

echo "=== Building BabyTracker Pi Image ==="

# Step 1: Build frontend
echo "[1/5] Building frontend..."
cd "${REPO_ROOT}/frontend"
npm ci --silent
npm run build

# Step 2: Copy frontend into Go embed directory
echo "[2/5] Preparing Go build..."
rm -rf "${REPO_ROOT}/internal/router/static/"*
cp -r "${REPO_ROOT}/frontend/dist/"* "${REPO_ROOT}/internal/router/static/"

# Step 3: Cross-compile Go binary for arm64
echo "[3/5] Cross-compiling Go binary for arm64..."
cd "${REPO_ROOT}"
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o "${STAGE_DIR}/01-install-app/files/babytracker" ./cmd/babytracker/

# Step 4: Copy scripts and service files into the stage
echo "[4/5] Copying support files..."
cp "${REPO_ROOT}/scripts/firstboot.sh" "${STAGE_DIR}/01-install-app/files/"
cp "${REPO_ROOT}/scripts/setup-wifi.sh" "${STAGE_DIR}/01-install-app/files/"
cp "${REPO_ROOT}/deploy/systemd/"*.service "${STAGE_DIR}/02-systemd-services/files/"

# Step 5: Run pi-gen
echo "[5/5] Running pi-gen Docker build..."
if [ ! -d "${PI_GEN_DIR}" ]; then
    git clone --depth 1 https://github.com/RPi-Distro/pi-gen.git "${PI_GEN_DIR}"
fi

# Link our custom stage into pi-gen
ln -sfn "${STAGE_DIR}" "${PI_GEN_DIR}/stage-babytracker"
cp "${SCRIPT_DIR}/config" "${PI_GEN_DIR}/config"

# Skip desktop stages — we only need Lite + our custom stage
touch "${PI_GEN_DIR}/stage3/SKIP" "${PI_GEN_DIR}/stage4/SKIP" "${PI_GEN_DIR}/stage5/SKIP"
touch "${PI_GEN_DIR}/stage3/SKIP_IMAGES" "${PI_GEN_DIR}/stage4/SKIP_IMAGES" "${PI_GEN_DIR}/stage5/SKIP_IMAGES"
touch "${PI_GEN_DIR}/stage2/SKIP_IMAGES"

cd "${PI_GEN_DIR}"
./build-docker.sh

echo ""
echo "=== Build complete! ==="
echo "Image: ${PI_GEN_DIR}/deploy/"
ls -lh "${PI_GEN_DIR}/deploy/"*.img* 2>/dev/null || echo "(check ${PI_GEN_DIR}/deploy/ for output)"
