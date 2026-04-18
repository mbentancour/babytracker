#!/bin/bash
# Configure UFW firewall for BabyTracker production mode.
# Idempotent — resets and reapplies rules.
set -euo pipefail

echo "[setup-ufw] Configuring production firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 443/tcp comment "BabyTracker HTTPS"
ufw --force enable

echo "[setup-ufw] Firewall configured."
