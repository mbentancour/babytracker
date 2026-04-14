#!/bin/bash -e

# Install service files
install -m 644 files/babytracker.service /etc/systemd/system/
install -m 644 files/babytracker-firstboot.service /etc/systemd/system/
install -m 644 files/babytracker-setup-ap.service /etc/systemd/system/

# Enable first-boot and setup-AP services (they have ConditionPathExists guards)
systemctl enable babytracker-firstboot.service
systemctl enable babytracker-setup-ap.service

# Enable PostgreSQL (needed by both first-boot and normal operation)
systemctl enable postgresql
