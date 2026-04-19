#!/bin/bash
# Returns 0 (and prints the IP) if the device has a routable IPv4 address
# on any non-wireless, non-loopback interface within a short timeout.
# Returns 1 (and prints nothing) otherwise.
set -uo pipefail

TIMEOUT="${1:-15}"

for i in $(seq 1 "${TIMEOUT}"); do
    # Look for any non-loopback, non-wifi interface with a global IPv4
    ip=$(ip -4 -o addr show scope global 2>/dev/null \
        | awk '$2!="lo" && $2!~/^wl/ {split($4,a,"/"); print a[1]; exit}')
    if [ -n "${ip}" ]; then
        echo "${ip}"
        exit 0
    fi
    sleep 1
done

exit 1
