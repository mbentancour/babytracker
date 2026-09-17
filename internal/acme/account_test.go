package acme

import (
	"encoding/json"
	"testing"

	"github.com/go-acme/lego/v5/acme"
)

const accountURL = "https://acme-v02.api.letsencrypt.org/acme/acct/123"

// Installs that got their certificate before the lego v5 upgrade have
// account.json in v4's layout. It must still yield the account URL, or every
// renewal is signed without a key ID and rejected by the CA.
func TestParseAccountLegoV4(t *testing.T) {
	data := []byte(`{"body":{"status":"valid","contact":["mailto:a@example.com"]},"uri":"` + accountURL + `"}`)
	reg := parseAccount(data)
	if reg == nil {
		t.Fatal("parseAccount returned nil for a v4 account file")
	}
	if reg.Location != accountURL {
		t.Errorf("Location = %q, want %q", reg.Location, accountURL)
	}
	if reg.Status != "valid" {
		t.Errorf("Status = %q, want %q", reg.Status, "valid")
	}
}

func TestParseAccountLegoV5(t *testing.T) {
	data, err := json.Marshal(acme.ExtendedAccount{
		Account:  acme.Account{Status: "valid"},
		Location: accountURL,
	})
	if err != nil {
		t.Fatal(err)
	}
	reg := parseAccount(data)
	if reg == nil || reg.Location != accountURL {
		t.Fatalf("parseAccount(%s) = %+v, want Location %q", data, reg, accountURL)
	}
}

// Without an account URL there is nothing usable to sign with, so the caller
// must register again rather than carry an empty account.
func TestParseAccountWithoutURL(t *testing.T) {
	for _, data := range []string{`{}`, `{"status":"valid"}`, `{"body":{"status":"valid"}}`, `not json`} {
		if reg := parseAccount([]byte(data)); reg != nil {
			t.Errorf("parseAccount(%s) = %+v, want nil", data, reg)
		}
	}
}
