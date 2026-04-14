#!/bin/bash -e

# Configure UFW firewall — setup mode allows AP-related ports
ufw default deny incoming
ufw default allow outgoing
ufw allow 53/udp comment "DNS for captive portal"
ufw allow 67/udp comment "DHCP for captive portal"
ufw allow 80/tcp comment "HTTP redirect for captive portal"
ufw allow 8099/tcp comment "BabyTracker HTTPS"
ufw allow 443/tcp comment "BabyTracker Let's Encrypt"
ufw --force enable

# Configure automatic security updates
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

# Disable SSH by default
systemctl disable ssh || true
systemctl disable sshd || true
