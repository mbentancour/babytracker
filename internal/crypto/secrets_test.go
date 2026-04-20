package crypto

import (
	"strings"
	"testing"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	if err := InitSecrets("a-test-master-secret-long-enough-to-derive"); err != nil {
		t.Fatalf("InitSecrets: %v", err)
	}
	cases := []string{
		"",
		"short",
		"a longer value with spaces and = and / characters",
		strings.Repeat("x", 4096),
	}
	for _, pt := range cases {
		ct := EncryptSecret(pt)
		got := DecryptSecret(ct)
		if got != pt {
			t.Errorf("round-trip lost value: got %q want %q", got, pt)
		}
	}
}

func TestEncryptEmptyStaysEmpty(t *testing.T) {
	if err := InitSecrets("any"); err != nil {
		t.Fatal(err)
	}
	if got := EncryptSecret(""); got != "" {
		t.Errorf("empty plaintext should produce empty output, got %q", got)
	}
}

func TestEncryptIdempotent(t *testing.T) {
	if err := InitSecrets("any"); err != nil {
		t.Fatal(err)
	}
	ct1 := EncryptSecret("secret")
	ct2 := EncryptSecret(ct1)
	if ct1 != ct2 {
		t.Errorf("re-encrypting an already-encrypted value should be a no-op")
	}
	if got := DecryptSecret(ct2); got != "secret" {
		t.Errorf("idempotent re-encrypt broke decryption: got %q", got)
	}
}

func TestDecryptPlaintextPassthrough(t *testing.T) {
	if err := InitSecrets("any"); err != nil {
		t.Fatal(err)
	}
	legacy := "some-old-plaintext-value"
	if got := DecryptSecret(legacy); got != legacy {
		t.Errorf("legacy plaintext must pass through unchanged, got %q", got)
	}
}

func TestDecryptWrongKeyReturnsEnvelope(t *testing.T) {
	InitSecrets("key-A")
	ct := EncryptSecret("hello")
	InitSecrets("key-B")
	got := DecryptSecret(ct)
	if got == "hello" {
		t.Errorf("DecryptSecret with wrong key must not recover plaintext")
	}
	if !strings.HasPrefix(got, secretPrefix) {
		t.Errorf("DecryptSecret with wrong key should return the envelope unchanged, got %q", got)
	}
}

func TestNoncesUnique(t *testing.T) {
	InitSecrets("any")
	a := EncryptSecret("same")
	b := EncryptSecret("same")
	if a == b {
		t.Errorf("two encryptions of the same plaintext must not produce identical ciphertext (nonce reuse)")
	}
}

func TestEncryptDecryptMap(t *testing.T) {
	InitSecrets("any")
	in := map[string]string{"USER": "alice", "KEY": "s3cret"}
	enc := EncryptMap(in)
	for k, v := range enc {
		if !strings.HasPrefix(v, secretPrefix) {
			t.Errorf("EncryptMap[%q] not wrapped: %q", k, v)
		}
	}
	dec := DecryptMap(enc)
	for k, v := range in {
		if dec[k] != v {
			t.Errorf("map round-trip lost %q: got %q want %q", k, dec[k], v)
		}
	}
}
