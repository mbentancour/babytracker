package storage

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"
)

// CertInfo is the metadata returned to the UI so the user can verify a
// server's certificate before trusting it. The PEM field is stored in the
// destination's config (never shown to the user); everything else is the
// friendly rendering for comparison against the server's admin panel.
type CertInfo struct {
	Subject     string    `json:"subject"`
	Issuer      string    `json:"issuer"`
	NotBefore   time.Time `json:"not_before"`
	NotAfter    time.Time `json:"not_after"`
	Fingerprint string    `json:"sha256_fingerprint"`
	SelfSigned  bool      `json:"self_signed"`
	PEM         string    `json:"pem"`
}

// FetchServerCert opens a raw TLS handshake to the host of rawURL and returns
// the leaf certificate metadata. Chain validation is disabled on purpose —
// the caller (an admin adding a new destination) needs to see even an
// otherwise-untrusted cert so they can decide whether to trust it.
//
// Returns an error if the host is missing or the TLS handshake fails at a
// level below cert validation (network unreachable, connection refused, etc.).
func FetchServerCert(ctx context.Context, rawURL string) (*CertInfo, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse url: %w", err)
	}
	if u.Scheme != "https" {
		return nil, fmt.Errorf("certificate fetch requires an https:// URL (got %q)", u.Scheme)
	}
	host := u.Host
	if _, _, err := net.SplitHostPort(host); err != nil {
		host = net.JoinHostPort(u.Host, "443")
	}

	d := tls.Dialer{Config: &tls.Config{InsecureSkipVerify: true}}
	c, err := d.DialContext(ctx, "tcp", host)
	if err != nil {
		return nil, fmt.Errorf("tls dial: %w", err)
	}
	defer c.Close()

	conn, ok := c.(*tls.Conn)
	if !ok {
		return nil, fmt.Errorf("unexpected connection type")
	}
	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return nil, fmt.Errorf("server presented no certificate")
	}
	cert := state.PeerCertificates[0]
	return certInfoFromCert(cert), nil
}

func certInfoFromCert(cert *x509.Certificate) *CertInfo {
	sum := sha256.Sum256(cert.Raw)
	fp := make([]string, 0, len(sum))
	for i := 0; i < len(sum); i++ {
		fp = append(fp, fmt.Sprintf("%02X", sum[i]))
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})
	return &CertInfo{
		Subject:     cert.Subject.String(),
		Issuer:      cert.Issuer.String(),
		NotBefore:   cert.NotBefore.UTC(),
		NotAfter:    cert.NotAfter.UTC(),
		Fingerprint: strings.Join(fp, ":"),
		SelfSigned:  cert.Subject.String() == cert.Issuer.String(),
		PEM:         string(pemBytes),
	}
}
