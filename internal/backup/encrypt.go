// Package backup — streaming AES-256-GCM encryption for backup archives.
//
// File format
// -----------
//
//	Magic       : 6 bytes = "BTENC1"
//	Version     : 1 byte  = 0x02
//	Salt        : 16 bytes (Argon2id salt)
//	Body        : sequence of chunks
//
// Each chunk:
//
//	Nonce       : 12 bytes (random, per-chunk)
//	CT length   : 4 bytes, big-endian uint32 (plaintext len + 16-byte tag)
//	Ciphertext  : CT length bytes (GCM ciphertext || 16-byte tag)
//
// Each chunk binds two pieces of positional metadata into the GCM
// additional-authenticated-data:
//
//	AAD = BE64(counter) || final?byte   (9 bytes)
//
// where counter starts at 0 and increments per chunk, and final is 0x01 for
// the last chunk in the stream (0x00 otherwise). This closes two attacks:
//
//   - chunk reordering: an attacker who swaps chunks N and M would produce a
//     stream where each chunk's counter no longer matches its own AAD → GCM
//     tag verification fails.
//   - truncation: since only the last chunk has final=1, any trailing-chunk
//     deletion leaves the stream ending on a chunk whose AAD claims it is not
//     final → DecryptStream refuses the stream as incomplete.
//
// Chunk plaintext size is 1 MiB — GCM's nonce-reuse limits are far above
// this since each chunk has its own fresh random nonce.
package backup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"

	"golang.org/x/crypto/argon2"
)

const (
	encMagic       = "BTENC1"
	encVersion     = 0x02
	encSaltSize    = 16
	encNonceSize   = 12
	encTagSize     = 16
	encChunkSize   = 1 << 20 // 1 MiB plaintext per chunk
	encHeaderSize  = 6 + 1 + encSaltSize
	verifierPlain  = "BabyTracker-OK"
	argon2Memory   = 64 * 1024 // 64 MiB
	argon2Time     = 3
	argon2Threads  = 4
	argon2KeyLen   = 32
)

// ErrWrongPassphrase is returned by DecryptStream / CheckVerifier when the
// passphrase-derived key fails to authenticate any chunk of the ciphertext.
var ErrWrongPassphrase = errors.New("wrong passphrase or corrupted backup")

func deriveKey(passphrase string, salt []byte) []byte {
	return argon2.IDKey([]byte(passphrase), salt, argon2Time, argon2Memory, argon2Threads, argon2KeyLen)
}

// EncryptStream encrypts src -> dst using a key derived from passphrase.
// A fresh random salt is generated per call.
func EncryptStream(dst io.Writer, src io.Reader, passphrase string) error {
	salt := make([]byte, encSaltSize)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	key := deriveKey(passphrase, salt)
	return encryptWithKey(dst, src, key, salt)
}

func encryptWithKey(dst io.Writer, src io.Reader, key, salt []byte) error {
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}

	// Header
	if _, err := dst.Write([]byte(encMagic)); err != nil {
		return err
	}
	if _, err := dst.Write([]byte{encVersion}); err != nil {
		return err
	}
	if _, err := dst.Write(salt); err != nil {
		return err
	}

	// Body — v2 binds (counter, final-flag) into the GCM AAD per chunk.
	// Peek a byte ahead so we know if the chunk we're about to seal is the
	// last one; that lets us set the final flag correctly without a second
	// pass over the stream.
	plain := make([]byte, encChunkSize)
	lenBuf := make([]byte, 4)
	nonce := make([]byte, encNonceSize)
	aad := make([]byte, 9)
	var counter uint64 = 0

	// Read-ahead loop: we hold one "next chunk" worth of bytes so we can tell
	// whether the current chunk is final.
	var buf []byte
	n, rerr := io.ReadFull(src, plain)
	if n > 0 {
		buf = make([]byte, n)
		copy(buf, plain[:n])
	}
	for buf != nil {
		nextN, nextErr := io.ReadFull(src, plain)
		isFinal := nextN == 0 // no more bytes after this chunk
		if _, err := rand.Read(nonce); err != nil {
			return err
		}
		binary.BigEndian.PutUint64(aad[:8], counter)
		if isFinal {
			aad[8] = 1
		} else {
			aad[8] = 0
		}
		ct := aead.Seal(nil, nonce, buf, aad)
		binary.BigEndian.PutUint32(lenBuf, uint32(len(ct)))
		if _, err := dst.Write(nonce); err != nil {
			return err
		}
		if _, err := dst.Write(lenBuf); err != nil {
			return err
		}
		if _, err := dst.Write(ct); err != nil {
			return err
		}
		counter++
		if isFinal {
			if nextErr != nil && nextErr != io.EOF && nextErr != io.ErrUnexpectedEOF {
				return nextErr
			}
			return nil
		}
		buf = make([]byte, nextN)
		copy(buf, plain[:nextN])
		if nextErr != nil && nextErr != io.EOF && nextErr != io.ErrUnexpectedEOF {
			return nextErr
		}
	}
	// Empty input — write nothing; decryption of empty body is valid.
	_ = rerr
	return nil
}

// DecryptStream decrypts src -> dst using a key derived from passphrase.
// Returns ErrWrongPassphrase when authentication fails, and a separate error
// for streams that decrypt cleanly but fail the chunk ordering/finality check.
func DecryptStream(dst io.Writer, src io.Reader, passphrase string) error {
	header := make([]byte, encHeaderSize)
	if _, err := io.ReadFull(src, header); err != nil {
		return fmt.Errorf("read header: %w", err)
	}
	if string(header[:6]) != encMagic {
		return errors.New("not a BabyTracker encrypted backup")
	}
	if header[6] != encVersion {
		return fmt.Errorf("unsupported encrypted backup version: %d", header[6])
	}
	salt := header[7:]
	key := deriveKey(passphrase, salt)

	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}

	nonce := make([]byte, encNonceSize)
	lenBuf := make([]byte, 4)
	aad := make([]byte, 9)
	var counter uint64 = 0
	sawFinal := false
	for {
		if _, err := io.ReadFull(src, nonce); err != nil {
			if err == io.EOF {
				// A non-empty archive must have ended on a final-flagged
				// chunk. counter==0 means the plaintext was empty (no
				// chunks ever written), which is accepted silently.
				if counter > 0 && !sawFinal {
					return fmt.Errorf("encrypted archive truncated (no final chunk)")
				}
				return nil
			}
			return fmt.Errorf("read nonce: %w", err)
		}
		if sawFinal {
			// Saw a chunk claiming to be final, but there's more data
			// after it — chunk reordering or splicing.
			return fmt.Errorf("encrypted archive has data after final chunk")
		}
		if _, err := io.ReadFull(src, lenBuf); err != nil {
			return fmt.Errorf("read chunk length: %w", err)
		}
		ctLen := binary.BigEndian.Uint32(lenBuf)
		if ctLen == 0 || ctLen > encChunkSize+encTagSize+1024 {
			return fmt.Errorf("invalid chunk length: %d", ctLen)
		}
		ct := make([]byte, ctLen)
		if _, err := io.ReadFull(src, ct); err != nil {
			return fmt.Errorf("read ciphertext: %w", err)
		}

		// Try final-flag both ways — the reader doesn't know which chunk is
		// final a priori, so it attempts final=1 first (common success for
		// the last chunk) and falls back to final=0. Both guesses are
		// authenticated, so neither leaks which is correct.
		binary.BigEndian.PutUint64(aad[:8], counter)
		aad[8] = 1
		pt, err := aead.Open(nil, nonce, ct, aad)
		if err == nil {
			sawFinal = true
		} else {
			aad[8] = 0
			pt, err = aead.Open(nil, nonce, ct, aad)
			if err != nil {
				return ErrWrongPassphrase
			}
		}

		if _, err := dst.Write(pt); err != nil {
			return err
		}
		counter++
	}
}

// MakeVerifier produces a small AES-GCM(passphrase, known-plaintext) blob that
// can be checked later to validate the passphrase before attempting a full
// decryption. Returns base64-encoded salt + verifier blob.
func MakeVerifier(passphrase string) (saltB64, verifierB64 string, err error) {
	salt := make([]byte, encSaltSize)
	if _, err := rand.Read(salt); err != nil {
		return "", "", err
	}
	key := deriveKey(passphrase, salt)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", "", err
	}
	nonce := make([]byte, encNonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return "", "", err
	}
	ct := aead.Seal(nil, nonce, []byte(verifierPlain), nil)
	blob := append(nonce, ct...)
	return base64.StdEncoding.EncodeToString(salt), base64.StdEncoding.EncodeToString(blob), nil
}

// CheckVerifier returns nil if passphrase matches the stored verifier.
// Returns ErrWrongPassphrase otherwise.
func CheckVerifier(passphrase, saltB64, verifierB64 string) error {
	salt, err := base64.StdEncoding.DecodeString(saltB64)
	if err != nil {
		return fmt.Errorf("invalid salt: %w", err)
	}
	blob, err := base64.StdEncoding.DecodeString(verifierB64)
	if err != nil {
		return fmt.Errorf("invalid verifier: %w", err)
	}
	if len(blob) < encNonceSize+encTagSize {
		return ErrWrongPassphrase
	}
	nonce := blob[:encNonceSize]
	ct := blob[encNonceSize:]

	key := deriveKey(passphrase, salt)
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	pt, err := aead.Open(nil, nonce, ct, nil)
	if err != nil || string(pt) != verifierPlain {
		return ErrWrongPassphrase
	}
	return nil
}
