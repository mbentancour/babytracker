package webhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

// signBody is the function subscribers have to replicate, so it's worth
// pinning its exact output. Any change to the prefix or encoding breaks every
// deployed subscriber; the test here is the contract.
func TestSignBodyFormat(t *testing.T) {
	sig := signBody("super-secret-0123456789abcdef", []byte(`{"event":"x"}`))

	mac := hmac.New(sha256.New, []byte("super-secret-0123456789abcdef"))
	mac.Write([]byte(`{"event":"x"}`))
	want := "sha256=" + hex.EncodeToString(mac.Sum(nil))

	if sig != want {
		t.Fatalf("signature mismatch\n got: %s\nwant: %s", sig, want)
	}
	if !strings.HasPrefix(sig, "sha256=") {
		t.Fatalf("missing sha256= prefix: %s", sig)
	}
}

func TestEventMatches(t *testing.T) {
	cases := []struct {
		sub, event string
		want       bool
	}{
		{"*", "feeding.created", true},
		{"", "feeding.created", true}, // empty defaults to match-all
		{"feeding.created", "feeding.created", true},
		{"feeding.created,sleep.created", "sleep.created", true},
		{"feeding.created, sleep.created", "sleep.created", true}, // whitespace tolerant
		{"feeding.created", "sleep.created", false},
		// Important: the DB query uses LIKE '%...%', which would match
		// "fed" inside "feeding.created". The code path must reject that.
		{"fed", "feeding.created", false},
	}
	for _, c := range cases {
		got := eventMatches(c.sub, c.event)
		if got != c.want {
			t.Errorf("eventMatches(%q, %q) = %v, want %v", c.sub, c.event, got, c.want)
		}
	}
}
