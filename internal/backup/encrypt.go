// Package backup — streaming AES-256-GCM encryption for backup archives.
//
// File format
// -----------
//
//	Magic       : 6 bytes = "BTENC1"
//	Version     : 1 byte  = 0x01
//	Salt        : 16 bytes (Argon2id salt)
//	Body        : sequence of chunks
//
// Each chunk:
//
//	Nonce       : 12 bytes (random, per-chunk)
//	CT length   : 4 bytes, big-endian uint32 (plaintext len + 16-byte tag)
//	Ciphertext  : CT length bytes (GCM ciphertext || 16-byte tag)
//
// The stream ends at the last chunk, detected by io.EOF before a new nonce.
// Chunk plaintext size is 1 MiB — GCM's nonce-reuse limits are far above
// this since each chunk has its own fresh nonce.
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
	encVersion     = 0x01
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

	// Body
	plain := make([]byte, encChunkSize)
	lenBuf := make([]byte, 4)
	nonce := make([]byte, encNonceSize)
	for {
		n, rerr := io.ReadFull(src, plain)
		if n > 0 {
			if _, err := rand.Read(nonce); err != nil {
				return err
			}
			ct := aead.Seal(nil, nonce, plain[:n], nil)
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
		}
		if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
			return nil
		}
		if rerr != nil {
			return rerr
		}
	}
}

// DecryptStream decrypts src -> dst using a key derived from passphrase.
// Returns ErrWrongPassphrase when authentication fails.
func DecryptStream(dst io.Writer, src io.Reader, passphrase string) error {
	// Header
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
	for {
		if _, err := io.ReadFull(src, nonce); err != nil {
			if err == io.EOF {
				return nil
			}
			return fmt.Errorf("read nonce: %w", err)
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
		pt, err := aead.Open(nil, nonce, ct, nil)
		if err != nil {
			return ErrWrongPassphrase
		}
		if _, err := dst.Write(pt); err != nil {
			return err
		}
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
