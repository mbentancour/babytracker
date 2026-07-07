package handlers

import (
	"net"
	"testing"
)

func TestIsPublicIP(t *testing.T) {
	cases := []struct {
		ip     string
		public bool
	}{
		{"8.8.8.8", true},
		{"1.1.1.1", true},
		{"93.184.216.34", true}, // example.com
		// Private / reserved — must all be rejected.
		{"10.0.0.5", false},
		{"192.168.1.1", false},
		{"172.16.0.1", false},
		{"172.31.255.255", false},
		{"127.0.0.1", false},
		{"169.254.169.254", false}, // cloud metadata
		{"169.254.1.1", false},     // link-local
		{"0.0.0.0", false},         // unspecified
		{"224.0.0.1", false},       // multicast
		{"::1", false},             // IPv6 loopback
		{"fc00::1", false},         // IPv6 ULA
		{"fe80::1", false},         // IPv6 link-local
		{"2606:4700:4700::1111", true}, // public IPv6 (Cloudflare)
	}
	for _, c := range cases {
		ip := net.ParseIP(c.ip)
		if ip == nil {
			t.Fatalf("bad test IP %q", c.ip)
		}
		if got := isPublicIP(ip); got != c.public {
			t.Errorf("isPublicIP(%s) = %v, want %v", c.ip, got, c.public)
		}
	}
}

func TestValidateBBURLScheme(t *testing.T) {
	for _, raw := range []string{
		"ftp://example.com",
		"file:///etc/passwd",
		"gopher://example.com",
		"//example.com",
	} {
		if err := validateBBURL(raw); err == nil {
			t.Errorf("validateBBURL(%q) accepted a non-http(s) scheme", raw)
		}
	}
}

func TestValidateBBURLRejectsInternalHostnames(t *testing.T) {
	for _, raw := range []string{
		"http://localhost/api",
		"https://metadata.google.internal/",
	} {
		if err := validateBBURL(raw); err == nil {
			t.Errorf("validateBBURL(%q) accepted an internal hostname", raw)
		}
	}
}

func TestValidateBBURLRejectsPrivateLiteralIPs(t *testing.T) {
	// Literal private IPs need no DNS resolution, so these are deterministic.
	for _, raw := range []string{
		"http://10.0.0.5/api",
		"http://192.168.1.10:8000/api",
		"http://169.254.169.254/latest/meta-data/",
		"http://[fc00::1]/api",
	} {
		if err := validateBBURL(raw); err == nil {
			t.Errorf("validateBBURL(%q) accepted a private/reserved IP", raw)
		}
	}
}

func TestValidateBBURLMissingHost(t *testing.T) {
	if err := validateBBURL("http://"); err == nil {
		t.Error("validateBBURL accepted a URL with no hostname")
	}
}
