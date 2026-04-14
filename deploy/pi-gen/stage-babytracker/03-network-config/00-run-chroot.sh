#!/bin/bash -e

# Install hostapd configuration for the setup access point
install -m 644 files/hostapd.conf /etc/hostapd/hostapd.conf

# Install dnsmasq configuration for the setup captive portal
install -m 644 files/dnsmasq-setup.conf /etc/dnsmasq.d/babytracker-setup.conf

# Install Avahi service for mDNS discovery (babytracker.local)
install -m 644 files/avahi-babytracker.service /etc/avahi/services/babytracker.service

# Enable Avahi for mDNS
systemctl enable avahi-daemon

# Set hostname
echo "babytracker" > /etc/hostname
sed -i 's/127\.0\.1\.1.*/127.0.1.1\tbabytracker/' /etc/hosts || \
    echo "127.0.1.1	babytracker" >> /etc/hosts
