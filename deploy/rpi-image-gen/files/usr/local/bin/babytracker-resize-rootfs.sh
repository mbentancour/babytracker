#!/bin/bash
# Expand the root partition and filesystem to fill the SD card on first boot.
# Idempotent: removes its own marker on completion so it doesn't run again.
set -uo pipefail
exec >> /var/log/babytracker-resize.log 2>&1

echo "=== Root FS resize: $(date) ==="

# Find the root partition device (e.g. /dev/mmcblk0p2 or /dev/sda2)
ROOT_PART=$(findmnt -n -o SOURCE /)
echo "Root partition: ${ROOT_PART}"

# Derive the disk and partition number
case "${ROOT_PART}" in
    /dev/mmcblk*p*) DISK="${ROOT_PART%p*}"; PART_NUM="${ROOT_PART##*p}" ;;
    /dev/nvme*p*)   DISK="${ROOT_PART%p*}"; PART_NUM="${ROOT_PART##*p}" ;;
    /dev/sd*)       DISK=$(echo "${ROOT_PART}" | sed 's/[0-9]*$//'); PART_NUM=$(echo "${ROOT_PART}" | sed 's/^[^0-9]*//') ;;
    *)              echo "Unknown root device: ${ROOT_PART}"; exit 1 ;;
esac

echo "Disk: ${DISK}, Partition: ${PART_NUM}"

# Grow the partition to fill available space (idempotent — exits 1 if no growth possible)
if growpart "${DISK}" "${PART_NUM}"; then
    echo "Partition grown."
else
    echo "Partition already at max size or growpart failed (this is fine if already grown)."
fi

# Resize the filesystem to match the new partition size
if resize2fs "${ROOT_PART}"; then
    echo "Filesystem resized."
else
    echo "Filesystem resize failed."
    exit 1
fi

echo "=== Resize complete ==="
