package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
	"sync"

	"golang.org/x/crypto/hkdf"
)

// Envelope format for stored credentials:
//
//	enc:v1:<base64(nonce || ciphertext || tag)>
//
// AES-256-GCM with a 12-byte random nonce per encryption. Legacy values (pre-
// upgrade) lack the prefix and are returned as-is by DecryptSecret so existing
// rows keep working until the handler that wrote them saves them again.
const (
	secretPrefix = "enc:v1:"
	nonceSize    = 12
)

// hkdfInfo binds the derived key to this purpose so the same master secret
// used elsewhere (JWT signing) won't produce the same key bits here.
const hkdfInfo = "babytracker-cred-encryption-v1"

var (
	secretsMu  sync.RWMutex
	secretsGCM cipher.AEAD
)

// InitSecrets derives the credential-encryption key from the process's master
// secret (the same .jwt_secret file used for JWT signing) and installs it as
// the package-global AEAD. Intended to be called exactly once at startup.
// Calling it again replaces the key — only useful for tests.
func InitSecrets(masterSecret string) error {
	if masterSecret == "" {
		return fmt.Errorf("secrets: master secret is empty")
	}
	// HKDF-SHA256 turns the hex-encoded JWT secret into a 32-byte AES key
	// bound to this specific purpose via the info string.
	r := hkdf.New(sha256.New, []byte(masterSecret), nil, []byte(hkdfInfo))
	key := make([]byte, 32)
	if _, err := io.ReadFull(r, key); err != nil {
		return fmt.Errorf("secrets: derive key: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return fmt.Errorf("secrets: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fmt.Errorf("secrets: new gcm: %w", err)
	}
	secretsMu.Lock()
	secretsGCM = gcm
	secretsMu.Unlock()
	return nil
}

// SecretsReady reports whether InitSecrets has been called.
func SecretsReady() bool {
	secretsMu.RLock()
	defer secretsMu.RUnlock()
	return secretsGCM != nil
}

// EncryptSecret wraps plaintext in the enc:v1: envelope. Empty input returns
// empty output so we don't emit ciphertext for absent values (e.g. optional
// fields that the user left blank). Already-encrypted values are returned
// unchanged so a save-after-load round trip doesn't double-encrypt.
func EncryptSecret(plaintext string) string {
	if plaintext == "" {
		return ""
	}
	if strings.HasPrefix(plaintext, secretPrefix) {
		return plaintext
	}
	secretsMu.RLock()
	gcm := secretsGCM
	secretsMu.RUnlock()
	if gcm == nil {
		// Not initialised — refuse silently rather than panic; caller will
		// see plaintext stored, which is the pre-upgrade behaviour.
		return plaintext
	}
	nonce := make([]byte, nonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return plaintext
	}
	ct := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	buf := make([]byte, 0, len(nonce)+len(ct))
	buf = append(buf, nonce...)
	buf = append(buf, ct...)
	return secretPrefix + base64.StdEncoding.EncodeToString(buf)
}

// DecryptSecret unwraps an enc:v1: envelope. Legacy plaintext values (no
// prefix) are returned unchanged so existing DB rows keep working until the
// next save rewrites them in encrypted form.
func DecryptSecret(s string) string {
	if s == "" || !strings.HasPrefix(s, secretPrefix) {
		return s
	}
	secretsMu.RLock()
	gcm := secretsGCM
	secretsMu.RUnlock()
	if gcm == nil {
		// No key available — hand back the envelope; the caller will see a
		// non-usable value which is safer than guessing at plaintext.
		return s
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(s, secretPrefix))
	if err != nil || len(raw) < nonceSize+gcm.Overhead() {
		return s
	}
	nonce, ct := raw[:nonceSize], raw[nonceSize:]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return s
	}
	return string(pt)
}

// EncryptMap returns a copy of m with every value wrapped. Used for the TLS
// config credentials map where all values are secrets.
func EncryptMap(m map[string]string) map[string]string {
	if m == nil {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = EncryptSecret(v)
	}
	return out
}

// DecryptMap inverts EncryptMap.
func DecryptMap(m map[string]string) map[string]string {
	if m == nil {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, v := range m {
		out[k] = DecryptSecret(v)
	}
	return out
}
