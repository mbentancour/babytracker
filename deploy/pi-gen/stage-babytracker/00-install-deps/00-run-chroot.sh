#!/bin/bash -e

# Disable services that should not auto-start — they are managed by our setup flow
systemctl disable hostapd || true
systemctl disable dnsmasq || true

# Use NetworkManager instead of dhcpcd for Wi-Fi management
systemctl enable NetworkManager || true
systemctl disable dhcpcd || true
