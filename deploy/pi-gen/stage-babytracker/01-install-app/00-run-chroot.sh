#!/bin/bash -e

# Create babytracker system user (no home dir, no login shell)
useradd --system --no-create-home --shell /usr/sbin/nologin babytracker || true

# Create application directories
mkdir -p /var/lib/babytracker/photos /var/lib/babytracker/backups /var/lib/babytracker/certs
mkdir -p /etc/babytracker
chown -R babytracker:babytracker /var/lib/babytracker
chmod 750 /var/lib/babytracker

# Install the pre-compiled binary
install -m 755 files/babytracker /usr/local/bin/babytracker

# Install environment file
install -m 640 -g babytracker files/babytracker.env /etc/babytracker/babytracker.env

# Install scripts
install -m 755 files/firstboot.sh /usr/local/bin/babytracker-firstboot.sh
install -m 755 files/setup-wifi.sh /usr/local/bin/babytracker-setup-wifi.sh

# Create the setup flag file — indicates first boot is needed
touch /var/lib/babytracker/.needs-setup
chown babytracker:babytracker /var/lib/babytracker/.needs-setup

# Allow the babytracker user to run specific commands as root
cat > /etc/sudoers.d/babytracker << 'EOF'
babytracker ALL=(root) NOPASSWD: /usr/local/bin/babytracker-setup-wifi.sh
babytracker ALL=(root) NOPASSWD: /usr/bin/systemctl reboot
babytracker ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff
EOF
chmod 440 /etc/sudoers.d/babytracker
