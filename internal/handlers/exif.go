package handlers

import (
	"encoding/binary"
	"io"
	"time"
)

// extractExifDate reads the file from the start and attempts to extract
// DateTimeOriginal or DateTime from JPEG EXIF metadata.
// Returns zero time if not found.
func extractExifDate(r io.ReadSeeker) (result time.Time) {
	// Recover from any panics caused by malformed data
	defer func() {
		if r := recover(); r != nil {
			result = time.Time{}
		}
	}()

	r.Seek(0, io.SeekStart)
	defer r.Seek(0, io.SeekStart)

	// Read up to 128KB — EXIF data is always near the start of the file
	header := make([]byte, 128*1024)
	n, err := io.ReadFull(r, header)
	if err != nil && n < 20 {
		return time.Time{}
	}
	header = header[:n]

	// Must be JPEG: FF D8
	if header[0] != 0xFF || header[1] != 0xD8 {
		return time.Time{}
	}

	// Scan for APP1 marker (FF E1) which contains EXIF
	pos := 2
	for pos+4 < len(header) {
		if header[pos] != 0xFF {
			pos++
			continue
		}
		marker := header[pos+1]

		// SOS marker — stop scanning
		if marker == 0xDA {
			break
		}

		segLen := int(binary.BigEndian.Uint16(header[pos+2 : pos+4]))
		if segLen < 2 || segLen > 65535 {
			break // Invalid segment length
		}

		if marker == 0xE1 && pos+2+segLen <= len(header) {
			seg := header[pos+4 : pos+2+segLen]
			t := parseExifSegment(seg)
			if !t.IsZero() {
				return t
			}
		}

		pos += 2 + segLen
	}

	return time.Time{}
}

func parseExifSegment(data []byte) time.Time {
	// Must start with "Exif\0\0"
	if len(data) < 14 || string(data[:6]) != "Exif\x00\x00" {
		return time.Time{}
	}
	tiff := data[6:]

	var bo binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return time.Time{}
	}

	// TIFF magic 42
	if bo.Uint16(tiff[2:4]) != 42 {
		return time.Time{}
	}

	ifd0Offset := int(bo.Uint32(tiff[4:8]))

	// Try IFD0 for DateTime (0x0132)
	var dateTime, dateTimeOriginal string
	dateTime = readStringTag(tiff, ifd0Offset, bo, 0x0132)

	// Find ExifIFD pointer (0x8769) in IFD0
	exifOffset := readUint32Tag(tiff, ifd0Offset, bo, 0x8769)
	if exifOffset > 0 && exifOffset < len(tiff) {
		dateTimeOriginal = readStringTag(tiff, exifOffset, bo, 0x9003)
	}

	// Prefer DateTimeOriginal over DateTime
	for _, dt := range []string{dateTimeOriginal, dateTime} {
		if dt == "" {
			continue
		}
		t, err := time.Parse("2006:01:02 15:04:05", dt)
		if err == nil {
			return t
		}
	}

	return time.Time{}
}

func readStringTag(tiff []byte, ifdOffset int, bo binary.ByteOrder, targetTag uint16) string {
	if ifdOffset+2 > len(tiff) {
		return ""
	}

	count := int(bo.Uint16(tiff[ifdOffset : ifdOffset+2]))
	if count > 200 || count < 0 {
		return ""
	}
	// Verify the IFD fits within the buffer
	if ifdOffset+2+count*12 > len(tiff) {
		return ""
	}

	for i := 0; i < count; i++ {
		offset := ifdOffset + 2 + i*12
		if offset+12 > len(tiff) {
			break
		}

		tag := bo.Uint16(tiff[offset : offset+2])
		if tag != targetTag {
			continue
		}

		dataType := bo.Uint16(tiff[offset+2 : offset+4])
		dataCount := int(bo.Uint32(tiff[offset+4 : offset+8]))

		if dataType != 2 || dataCount <= 0 || dataCount > 1024 { // ASCII, sane size
			continue
		}

		if dataCount <= 4 {
			if offset+8+dataCount > len(tiff) {
				continue
			}
			s := string(tiff[offset+8 : offset+8+dataCount])
			return trimNull(s)
		}

		valOffset := int(bo.Uint32(tiff[offset+8 : offset+12]))
		if valOffset+dataCount > len(tiff) {
			continue
		}
		s := string(tiff[valOffset : valOffset+dataCount])
		return trimNull(s)
	}

	return ""
}

func readUint32Tag(tiff []byte, ifdOffset int, bo binary.ByteOrder, targetTag uint16) int {
	if ifdOffset+2 > len(tiff) {
		return 0
	}

	count := int(bo.Uint16(tiff[ifdOffset : ifdOffset+2]))
	if count > 200 || count < 0 || ifdOffset+2+count*12 > len(tiff) {
		return 0
	}

	for i := 0; i < count; i++ {
		offset := ifdOffset + 2 + i*12
		if offset+12 > len(tiff) {
			break
		}

		tag := bo.Uint16(tiff[offset : offset+2])
		if tag != targetTag {
			continue
		}

		return int(bo.Uint32(tiff[offset+8 : offset+12]))
	}

	return 0
}

func trimNull(s string) string {
	for len(s) > 0 && s[len(s)-1] == 0 {
		s = s[:len(s)-1]
	}
	return s
}
