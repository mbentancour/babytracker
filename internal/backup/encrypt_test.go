package backup

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"testing"
)

// Exercise the v2 format end-to-end: roundtrip, wrong passphrase,
// chunk reordering, and truncation should all produce the right errors.
func TestEncryptDecryptRoundtrip(t *testing.T) {
	sizes := []int{0, 128, encChunkSize - 1, encChunkSize, encChunkSize + 1, 3*encChunkSize + 42}
	for _, n := range sizes {
		plaintext := make([]byte, n)
		_, _ = rand.Read(plaintext)

		var ct bytes.Buffer
		if err := EncryptStream(&ct, bytes.NewReader(plaintext), "hunter2"); err != nil {
			t.Fatalf("encrypt (n=%d): %v", n, err)
		}

		var pt bytes.Buffer
		if err := DecryptStream(&pt, bytes.NewReader(ct.Bytes()), "hunter2"); err != nil {
			t.Fatalf("decrypt (n=%d): %v", n, err)
		}
		if !bytes.Equal(pt.Bytes(), plaintext) {
			t.Fatalf("roundtrip mismatch (n=%d)", n)
		}
	}
}

func TestDecryptWrongPassphrase(t *testing.T) {
	var ct bytes.Buffer
	if err := EncryptStream(&ct, bytes.NewReader([]byte("hello world")), "right"); err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	err := DecryptStream(&bytes.Buffer{}, bytes.NewReader(ct.Bytes()), "wrong")
	if err != ErrWrongPassphrase {
		t.Fatalf("expected ErrWrongPassphrase, got %v", err)
	}
}

// Truncating the ciphertext by removing the last chunk must be rejected:
// v2 binds a final-flag into each chunk's AAD, so the decrypter refuses a
// stream that ends without seeing a final-flagged chunk.
func TestDecryptTruncated(t *testing.T) {
	plaintext := make([]byte, 3*encChunkSize) // guarantees ≥3 chunks
	_, _ = rand.Read(plaintext)

	var ct bytes.Buffer
	if err := EncryptStream(&ct, bytes.NewReader(plaintext), "k"); err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	// Strip the last chunk. We know the format: header + N*(nonce+len+ct).
	buf := ct.Bytes()
	idx := encHeaderSize
	var lastStart int
	for idx < len(buf) {
		lastStart = idx
		if idx+encNonceSize+4 > len(buf) {
			break
		}
		ctLen := binary.BigEndian.Uint32(buf[idx+encNonceSize : idx+encNonceSize+4])
		idx += encNonceSize + 4 + int(ctLen)
	}
	truncated := buf[:lastStart]

	err := DecryptStream(&bytes.Buffer{}, bytes.NewReader(truncated), "k")
	if err == nil {
		t.Fatal("expected error on truncated archive, got nil")
	}
}

// Swapping two chunks must also be rejected — the counter in each chunk's
// AAD no longer matches its position in the stream.
func TestDecryptReordered(t *testing.T) {
	plaintext := make([]byte, 3*encChunkSize)
	_, _ = rand.Read(plaintext)

	var ct bytes.Buffer
	if err := EncryptStream(&ct, bytes.NewReader(plaintext), "k"); err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	// Parse chunk offsets.
	buf := ct.Bytes()
	idx := encHeaderSize
	type chunk struct{ start, end int }
	var chunks []chunk
	for idx < len(buf) {
		start := idx
		ctLen := binary.BigEndian.Uint32(buf[idx+encNonceSize : idx+encNonceSize+4])
		idx += encNonceSize + 4 + int(ctLen)
		chunks = append(chunks, chunk{start, idx})
	}
	if len(chunks) < 3 {
		t.Fatalf("need ≥3 chunks for reorder test, got %d", len(chunks))
	}

	// Swap chunk 0 and chunk 1.
	reordered := make([]byte, 0, len(buf))
	reordered = append(reordered, buf[:encHeaderSize]...)
	reordered = append(reordered, buf[chunks[1].start:chunks[1].end]...)
	reordered = append(reordered, buf[chunks[0].start:chunks[0].end]...)
	for _, c := range chunks[2:] {
		reordered = append(reordered, buf[c.start:c.end]...)
	}

	err := DecryptStream(&bytes.Buffer{}, bytes.NewReader(reordered), "k")
	if err == nil {
		t.Fatal("expected error on reordered archive, got nil")
	}
}
