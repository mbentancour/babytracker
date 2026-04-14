package handlers

import (
	"encoding/binary"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	_ "golang.org/x/image/webp"
	"golang.org/x/image/draw"
)

// Thumbnail size presets (longest edge in pixels).
var thumbnailSizes = map[string]int{
	"thumb":  300,
	"medium": 800,
}

// In-flight generation guard so concurrent requests for the same thumb don't race.
var thumbMu sync.Map // key: dstPath -> *sync.Mutex

func getThumbMutex(key string) *sync.Mutex {
	m, _ := thumbMu.LoadOrStore(key, &sync.Mutex{})
	return m.(*sync.Mutex)
}

// thumbnailPath returns where the cached thumbnail for srcPath at the given size lives.
// Hidden directory under photos dir keeps thumbs out of the gallery filesystem scan.
func thumbnailPath(photosDir, filename, sizeName string) string {
	// Always JPEG output for thumbs (smaller, sufficient quality)
	base := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))
	return filepath.Join(photosDir, ".thumbs", sizeName, base+".jpg")
}

// generateThumbnail creates a JPEG at dstPath sized to fit within maxDim on the longest edge.
// Decodes JPEG/PNG/WebP via stdlib + x/image registrations (imported above).
// Respects EXIF orientation so camera photos aren't sideways.
func generateThumbnail(srcPath, dstPath string, maxDim int) error {
	src, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer src.Close()

	// Read EXIF orientation from JPEG (PNG/WebP don't have EXIF orientation)
	orientation := 1
	if strings.EqualFold(filepath.Ext(srcPath), ".jpg") || strings.EqualFold(filepath.Ext(srcPath), ".jpeg") {
		if o, err := readJPEGOrientation(src); err == nil {
			orientation = o
		}
		// Rewind for Decode
		src.Seek(0, 0)
	}

	img, _, err := image.Decode(src)
	if err != nil {
		return err
	}

	// Apply orientation transform (1=normal, 3=180°, 6=90° CW, 8=90° CCW; 2/4/5/7 also flip)
	img = applyOrientation(img, orientation)

	bounds := img.Bounds()
	srcW, srcH := bounds.Dx(), bounds.Dy()

	// Skip resize if image is already smaller than the target — but still re-encode
	// as JPEG so the frontend can rely on a uniform format/extension.
	var nw, nh int
	if srcW <= maxDim && srcH <= maxDim {
		nw, nh = srcW, srcH
	} else if srcW > srcH {
		nw = maxDim
		nh = srcH * maxDim / srcW
	} else {
		nh = maxDim
		nw = srcW * maxDim / srcH
	}

	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, bounds, draw.Over, nil)

	if err := os.MkdirAll(filepath.Dir(dstPath), 0750); err != nil {
		return err
	}
	// Write to temp file then atomic rename, so partial files never get served.
	tmp, err := os.CreateTemp(filepath.Dir(dstPath), ".tmp-*.jpg")
	if err != nil {
		return err
	}
	defer func() {
		tmp.Close()
		os.Remove(tmp.Name())
	}()

	if err := jpeg.Encode(tmp, dst, &jpeg.Options{Quality: 85}); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), dstPath)
}

// ensureThumbnail returns the path to a usable thumbnail, generating it if missing.
// Returns empty string if the source file isn't a supported image.
func ensureThumbnail(photosDir, filename, sizeName string) (string, error) {
	maxDim, ok := thumbnailSizes[sizeName]
	if !ok {
		return "", nil
	}

	srcPath := filepath.Join(photosDir, filename)
	dstPath := thumbnailPath(photosDir, filename, sizeName)

	// Cached thumbnail exists and is newer than the source → use it.
	if srcStat, err := os.Stat(srcPath); err == nil {
		if dstStat, err := os.Stat(dstPath); err == nil && !dstStat.ModTime().Before(srcStat.ModTime()) {
			return dstPath, nil
		}
	} else {
		return "", err
	}

	// Generate. Use a per-thumb mutex to coalesce concurrent requests.
	mu := getThumbMutex(dstPath)
	mu.Lock()
	defer mu.Unlock()

	// Re-check inside lock
	if _, err := os.Stat(dstPath); err == nil {
		return dstPath, nil
	}

	if err := generateThumbnail(srcPath, dstPath, maxDim); err != nil {
		return "", err
	}
	return dstPath, nil
}

// copyFile is a small helper for rare paths where we can't decode the image
// but still want to serve something.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0750); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

// readJPEGOrientation parses JPEG APP1 (EXIF) markers and returns the Orientation
// tag value (1-8). Returns 1 if not found or on any parse issue — this is a
// best-effort helper, failure should never block thumbnailing.
//
// JPEG structure: starts with FFD8, then a sequence of segments. APP1 is FFE1,
// followed by a 2-byte big-endian length (including the length bytes themselves),
// then the payload. EXIF APP1 payload starts with "Exif\0\0" then a TIFF header.
// TIFF header: byte order ("II" little-endian or "MM" big-endian), 2-byte magic
// 0x002A, 4-byte offset to the first IFD. IFD entries are 12 bytes each:
// 2-byte tag, 2-byte type, 4-byte count, 4-byte value/offset. Orientation tag = 0x0112.
func readJPEGOrientation(r io.Reader) (int, error) {
	buf := make([]byte, 2)
	if _, err := io.ReadFull(r, buf); err != nil {
		return 1, err
	}
	if buf[0] != 0xFF || buf[1] != 0xD8 {
		return 1, nil // not a JPEG
	}

	for {
		if _, err := io.ReadFull(r, buf); err != nil {
			return 1, err
		}
		if buf[0] != 0xFF {
			return 1, nil
		}
		marker := buf[1]
		// Skip padding FFs
		for marker == 0xFF {
			b := make([]byte, 1)
			if _, err := io.ReadFull(r, b); err != nil {
				return 1, err
			}
			marker = b[0]
		}
		// SOS (Start of Scan) = FFDA → past the metadata, stop.
		if marker == 0xDA || marker == 0xD9 {
			return 1, nil
		}
		// Segments FFD0..FFD9 (TEM, RST0..7, EOI) have no length
		if marker >= 0xD0 && marker <= 0xD9 {
			continue
		}

		// Read length (big-endian, includes the 2 length bytes)
		if _, err := io.ReadFull(r, buf); err != nil {
			return 1, err
		}
		segLen := int(binary.BigEndian.Uint16(buf)) - 2
		if segLen < 0 {
			return 1, nil
		}

		if marker != 0xE1 {
			// Not APP1; skip
			if _, err := io.CopyN(io.Discard, r, int64(segLen)); err != nil {
				return 1, err
			}
			continue
		}

		// Read APP1 payload
		payload := make([]byte, segLen)
		if _, err := io.ReadFull(r, payload); err != nil {
			return 1, err
		}
		if len(payload) < 14 || string(payload[:6]) != "Exif\x00\x00" {
			continue // some other APP1 (e.g. XMP)
		}
		tiff := payload[6:]

		// TIFF byte order
		var bo binary.ByteOrder
		switch string(tiff[:2]) {
		case "II":
			bo = binary.LittleEndian
		case "MM":
			bo = binary.BigEndian
		default:
			return 1, nil
		}
		if bo.Uint16(tiff[2:4]) != 0x002A {
			return 1, nil
		}
		ifd0Offset := bo.Uint32(tiff[4:8])
		if int(ifd0Offset)+2 > len(tiff) {
			return 1, nil
		}
		numEntries := bo.Uint16(tiff[ifd0Offset:])
		entries := tiff[ifd0Offset+2:]
		for i := 0; i < int(numEntries); i++ {
			off := i * 12
			if off+12 > len(entries) {
				break
			}
			tag := bo.Uint16(entries[off:])
			if tag == 0x0112 { // Orientation
				// For SHORT type the value is in the first 2 bytes of the value field
				return int(bo.Uint16(entries[off+8:])), nil
			}
		}
		return 1, nil
	}
}

// applyOrientation rotates/flips an image according to an EXIF orientation value.
// 1: normal, 2: flip horizontal, 3: 180°, 4: flip vertical,
// 5: transpose, 6: 90° CW, 7: transverse, 8: 90° CCW.
func applyOrientation(img image.Image, orientation int) image.Image {
	if orientation <= 1 || orientation > 8 {
		return img
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	// Transformed dimensions depend on whether we swap axes (5,6,7,8 swap)
	var dst *image.RGBA
	swap := orientation >= 5
	if swap {
		dst = image.NewRGBA(image.Rect(0, 0, h, w))
	} else {
		dst = image.NewRGBA(image.Rect(0, 0, w, h))
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := img.At(b.Min.X+x, b.Min.Y+y)
			var nx, ny int
			switch orientation {
			case 2: // flip horizontal
				nx, ny = w-1-x, y
			case 3: // rotate 180
				nx, ny = w-1-x, h-1-y
			case 4: // flip vertical
				nx, ny = x, h-1-y
			case 5: // transpose (flip along TL-BR)
				nx, ny = y, x
			case 6: // rotate 90 CW
				nx, ny = h-1-y, x
			case 7: // transverse (flip along TR-BL)
				nx, ny = h-1-y, w-1-x
			case 8: // rotate 90 CCW
				nx, ny = y, w-1-x
			}
			dst.Set(nx, ny, c)
		}
	}
	return dst
}
