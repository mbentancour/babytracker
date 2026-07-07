package acme

import (
	"crypto/x509"
	"net"
	"testing"
	"time"
)

func parseLeaf(t *testing.T, domain string) *x509.Certificate {
	t.Helper()
	cert, err := GenerateSelfSignedCert(domain)
	if err != nil {
		t.Fatalf("GenerateSelfSignedCert: %v", err)
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return leaf
}

// Apple platforms reject TLS server certs valid for more than 398 days —
// the "Safari can't establish a secure connection" failure. The self-signed
// fallback must stay under that.
func TestSelfSignedValidityUnder398Days(t *testing.T) {
	leaf := parseLeaf(t, "babytracker.local")
	span := leaf.NotAfter.Sub(leaf.NotBefore)
	if span > 398*24*time.Hour {
		t.Fatalf("validity span %v exceeds Apple's 398-day limit", span)
	}
	if span < 300*24*time.Hour {
		t.Fatalf("validity span %v unexpectedly short", span)
	}
}

// Safari matches only Subject Alternative Names, never CommonName, so local
// testing over https://localhost requires loopback SANs.
func TestSelfSignedCoversLoopback(t *testing.T) {
	leaf := parseLeaf(t, "babytracker.local")

	if err := leaf.VerifyHostname("localhost"); err != nil {
		t.Errorf("cert does not cover localhost: %v", err)
	}
	if err := leaf.VerifyHostname("127.0.0.1"); err != nil {
		t.Errorf("cert does not cover 127.0.0.1: %v", err)
	}
	if err := leaf.VerifyHostname("babytracker.local"); err != nil {
		t.Errorf("cert does not cover the configured domain: %v", err)
	}

	found := false
	for _, ip := range leaf.IPAddresses {
		if ip.Equal(net.IPv6loopback) {
			found = true
		}
	}
	if !found {
		t.Error("cert does not cover ::1")
	}
}

// A bare IP as the configured host must land in IPAddresses (SAN), not be
// dropped as a non-DNS name.
func TestSelfSignedWithIPDomain(t *testing.T) {
	leaf := parseLeaf(t, "192.168.1.50")
	if err := leaf.VerifyHostname("192.168.1.50"); err != nil {
		t.Errorf("cert does not cover the configured IP: %v", err)
	}
}

func TestSelfSignedSerialIsRandom(t *testing.T) {
	a := parseLeaf(t, "babytracker.local")
	b := parseLeaf(t, "babytracker.local")
	if a.SerialNumber.Cmp(b.SerialNumber) == 0 {
		t.Fatal("two generated certs share a serial number")
	}
}
