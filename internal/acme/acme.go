// Package acme provides ACME certificate management with DNS-01 challenge support.
// It wraps the lego library to obtain and renew Let's Encrypt certificates using
// DNS providers (Cloudflare, Route53, DuckDNS, Namecheap, Simply.com).
package acme

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log/slog"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-acme/lego/v4/certcrypto"
	"github.com/go-acme/lego/v4/certificate"
	"github.com/go-acme/lego/v4/challenge"
	"github.com/go-acme/lego/v4/challenge/dns01"
	"github.com/go-acme/lego/v4/lego"
	"github.com/go-acme/lego/v4/providers/dns/cloudflare"
	"github.com/go-acme/lego/v4/providers/dns/duckdns"
	"github.com/go-acme/lego/v4/providers/dns/namecheap"
	"github.com/go-acme/lego/v4/providers/dns/route53"
	"github.com/go-acme/lego/v4/providers/dns/simply"
	"github.com/go-acme/lego/v4/registration"
)

// GenerateSelfSignedCert creates an in-memory self-signed TLS certificate.
// Used as a fallback when no cert files exist and ACME hasn't completed yet.
func GenerateSelfSignedCert(domain string) (*tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: domain},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	if domain != "" {
		template.DNSNames = []string{domain}
	}
	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return nil, err
	}
	return &tls.Certificate{
		Certificate: [][]byte{certDER},
		PrivateKey:  key,
	}, nil
}

// SaveCertToFiles writes a tls.Certificate's PEM-encoded cert and key to disk.
func SaveCertToFiles(cert *tls.Certificate, certPath, keyPath string) {
	if len(cert.Certificate) == 0 {
		return
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Certificate[0]})
	os.WriteFile(certPath, certPEM, 0644)

	if key, ok := cert.PrivateKey.(*ecdsa.PrivateKey); ok {
		keyBytes, err := x509.MarshalECPrivateKey(key)
		if err == nil {
			keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes})
			os.WriteFile(keyPath, keyPEM, 0600)
		}
	}
}

// Supported DNS provider names.
const (
	ProviderCloudflare = "cloudflare"
	ProviderRoute53    = "route53"
	ProviderDuckDNS    = "duckdns"
	ProviderNamecheap  = "namecheap"
	ProviderSimply     = "simply"
)

// Config holds the settings for DNS-01 ACME certificate management.
type Config struct {
	Domain   string // Domain to obtain a certificate for
	Email    string // ACME account email (used for expiry notices)
	Provider string // DNS provider name
	CertsDir string // Directory to store certificates and account key
	IP       string // IP for the A record (empty = auto-detect LAN IP)
	ManageA  bool   // Whether to create/update the A record via the DNS provider
}

// CertInfo holds public information about the current certificate.
type CertInfo struct {
	Domain  string    `json:"domain"`
	Issuer  string    `json:"issuer"`
	Expires time.Time `json:"expires"`
}

// Manager handles certificate issuance, renewal, and TLS config.
type Manager struct {
	cfg      Config
	mu       sync.RWMutex
	cert     *tls.Certificate
	cancelFn context.CancelFunc // cancels the current renewal loop
	status   string             // "idle", "obtaining", "active", "error"
	lastErr  string             // last error message (if status == "error")
}


// legoUser implements registration.User for the lego ACME client.
type legoUser struct {
	email string
	key   crypto.PrivateKey
	reg   *registration.Resource
}

func (u *legoUser) GetEmail() string                        { return u.email }
func (u *legoUser) GetPrivateKey() crypto.PrivateKey        { return u.key }
func (u *legoUser) GetRegistration() *registration.Resource { return u.reg }

// NewManager creates a new ACME certificate manager. Call Run() to start
// the certificate lifecycle (obtain + renew).
func NewManager(cfg Config) (*Manager, error) {
	if cfg.Domain == "" {
		return nil, fmt.Errorf("acme: domain is required")
	}
	if cfg.Provider == "" {
		return nil, fmt.Errorf("acme: DNS provider is required")
	}
	if cfg.CertsDir == "" {
		return nil, fmt.Errorf("acme: certs directory is required")
	}
	if cfg.Email == "" {
		cfg.Email = "admin@" + cfg.Domain
	}
	return &Manager{cfg: cfg}, nil
}

// TLSConfig returns a tls.Config that serves the managed certificate.
// The certificate is loaded lazily on the first TLS handshake.
func (m *Manager) TLSConfig() *tls.Config {
	return &tls.Config{
		GetCertificate: m.getCertificate,
		MinVersion:     tls.VersionTLS12,
	}
}

func (m *Manager) getCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	m.mu.RLock()
	cert := m.cert
	m.mu.RUnlock()
	if cert != nil {
		return cert, nil
	}
	return nil, fmt.Errorf("acme: certificate not yet available")
}

// CertInfo returns public information about the current certificate, or nil if
// no certificate is loaded.
func (m *Manager) CertInfo() *CertInfo {
	m.mu.RLock()
	cert := m.cert
	m.mu.RUnlock()
	if cert == nil {
		return nil
	}
	leaf := cert.Leaf
	if leaf == nil && len(cert.Certificate) > 0 {
		parsed, _ := x509.ParseCertificate(cert.Certificate[0])
		leaf = parsed
	}
	if leaf == nil {
		return nil
	}
	issuer := leaf.Issuer.Organization
	issuerStr := ""
	if len(issuer) > 0 {
		issuerStr = issuer[0]
	}
	return &CertInfo{
		Domain:  leaf.Subject.CommonName,
		Issuer:  issuerStr,
		Expires: leaf.NotAfter,
	}
}

// Run starts the certificate lifecycle. It never blocks and never fails:
//   - If a cached certificate exists on disk, it's loaded immediately.
//   - A background goroutine obtains a new cert (if needed) and handles renewals.
//   - The managed TLSConfig serves whatever cert is currently available.
//
// The server can start immediately with a self-signed cert as fallback;
// once the ACME cert is ready, it's swapped in via GetCertificate.
func (m *Manager) Run() {
	os.MkdirAll(m.cfg.CertsDir, 0700)

	// Try loading a cached certificate (non-blocking best-effort)
	if err := m.loadCached(); err == nil {
		m.setStatus("active", "")
		slog.Info("acme: loaded cached certificate", "domain", m.cfg.Domain)
	} else {
		slog.Info("acme: no cached certificate, will obtain in background", "domain", m.cfg.Domain)
	}

	// Start background obtain + renewal loop
	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	m.cancelFn = cancel
	m.mu.Unlock()
	go m.obtainAndRenewLoop(ctx)
}

// HasCert returns true if the manager has a certificate loaded (cached or newly obtained).
func (m *Manager) HasCert() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cert != nil
}

// Status returns the current ACME status and last error (if any).
func (m *Manager) Status() (status string, lastErr string) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.status == "" {
		return "idle", ""
	}
	return m.status, m.lastErr
}

func (m *Manager) setStatus(status, errMsg string) {
	m.mu.Lock()
	m.status = status
	m.lastErr = errMsg
	m.mu.Unlock()
}

// Reconfigure updates the ACME configuration and restarts the background
// obtain/renewal loop. Called when the user changes TLS settings via the UI.
// The new certificate is obtained in the background — this method returns immediately.
func (m *Manager) Reconfigure(cfg Config) {
	if cfg.Email == "" {
		cfg.Email = "admin@" + cfg.Domain
	}

	// Stop existing loop
	m.mu.Lock()
	if m.cancelFn != nil {
		m.cancelFn()
	}
	m.cfg = cfg
	m.cert = nil
	m.mu.Unlock()

	os.MkdirAll(cfg.CertsDir, 0700)

	slog.Info("acme: reconfiguring", "domain", cfg.Domain, "provider", cfg.Provider)

	// Start new background loop (will obtain + renew)
	ctx, cancel := context.WithCancel(context.Background())
	m.mu.Lock()
	m.cancelFn = cancel
	m.mu.Unlock()
	go m.obtainAndRenewLoop(ctx)
}

func (m *Manager) obtain() error {
	client, err := m.newClient()
	if err != nil {
		return err
	}

	request := certificate.ObtainRequest{
		Domains: []string{m.cfg.Domain},
		Bundle:  true,
	}
	cert, err := client.Certificate.Obtain(request)
	if err != nil {
		return fmt.Errorf("obtain certificate: %w", err)
	}

	if err := m.saveCert(cert); err != nil {
		return fmt.Errorf("save certificate: %w", err)
	}
	return m.loadCached()
}

// obtainAndRenewLoop runs in the background. It obtains a certificate if none
// is loaded, then sleeps until renewal is needed. Failures are retried with
// increasing backoff. The server keeps running with whatever cert it has
// (self-signed or previous ACME cert) while this loop works.
func (m *Manager) obtainAndRenewLoop(ctx context.Context) {
	retryDelay := 5 * time.Minute

	for {
		m.mu.RLock()
		cert := m.cert
		m.mu.RUnlock()

		if cert == nil {
			// Ensure A record exists before attempting ACME
			if m.cfg.ManageA {
				if err := EnsureARecord(m.cfg.Provider, m.cfg.Domain, m.cfg.IP); err != nil {
					slog.Warn("acme: failed to set A record, continuing anyway", "error", err)
				}
			}

			// No certificate — try to obtain one
			m.setStatus("obtaining", "")
			slog.Info("acme: obtaining certificate", "domain", m.cfg.Domain, "provider", m.cfg.Provider)
			if err := m.obtain(); err != nil {
				m.setStatus("error", err.Error())
				slog.Error("acme: failed to obtain certificate, will retry",
					"error", err, "retry_in", retryDelay)
				select {
				case <-ctx.Done():
					return
				case <-time.After(retryDelay):
				}
				// Back off: 5m → 10m → 20m → ... capped at 1h
				retryDelay = min(retryDelay*2, time.Hour)
				continue
			}
			m.setStatus("active", "")
			slog.Info("acme: certificate obtained", "domain", m.cfg.Domain)
			retryDelay = 5 * time.Minute // reset on success
			continue                     // re-enter loop to check expiry
		}

		// Certificate loaded — figure out when to renew
		leaf := cert.Leaf
		if leaf == nil && len(cert.Certificate) > 0 {
			parsed, err := x509.ParseCertificate(cert.Certificate[0])
			if err == nil {
				leaf = parsed
			}
		}

		if leaf == nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Hour):
				continue
			}
		}

		// Renew when less than 30 days remain
		renewAt := leaf.NotAfter.Add(-30 * 24 * time.Hour)
		sleepDur := time.Until(renewAt)
		if sleepDur > 0 {
			slog.Info("acme: certificate valid, next renewal",
				"domain", m.cfg.Domain,
				"expires", leaf.NotAfter,
				"renew_at", renewAt,
			)
			select {
			case <-ctx.Done():
				return
			case <-time.After(sleepDur):
			}
		}

		m.setStatus("obtaining", "")
		slog.Info("acme: renewing certificate", "domain", m.cfg.Domain)
		if err := m.obtain(); err != nil {
			m.setStatus("error", err.Error())
			slog.Error("acme: renewal failed, retrying in 1 hour", "error", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Hour):
			}
		} else {
			m.setStatus("active", "")
			slog.Info("acme: certificate renewed", "domain", m.cfg.Domain)
		}
	}
}

func (m *Manager) newClient() (*lego.Client, error) {
	user, err := m.loadOrCreateAccount()
	if err != nil {
		return nil, fmt.Errorf("load account: %w", err)
	}

	config := lego.NewConfig(user)
	config.Certificate.KeyType = certcrypto.EC256

	client, err := lego.NewClient(config)
	if err != nil {
		return nil, fmt.Errorf("create ACME client: %w", err)
	}

	provider, err := m.newDNSProvider()
	if err != nil {
		return nil, fmt.Errorf("create DNS provider: %w", err)
	}
	// Use public DNS servers for propagation checks instead of the local
	// resolver, which often caches negative responses and causes timeouts.
	if err := client.Challenge.SetDNS01Provider(provider,
		dns01.AddRecursiveNameservers([]string{"1.1.1.1:53", "8.8.8.8:53"}),
	); err != nil {
		return nil, fmt.Errorf("set DNS provider: %w", err)
	}

	// Register account if needed
	if user.GetRegistration() == nil {
		reg, err := client.Registration.Register(registration.RegisterOptions{TermsOfServiceAgreed: true})
		if err != nil {
			return nil, fmt.Errorf("register account: %w", err)
		}
		user.reg = reg
		m.saveAccount(user)
	}

	return client, nil
}

func (m *Manager) newDNSProvider() (challenge.Provider, error) {
	switch strings.ToLower(m.cfg.Provider) {
	case ProviderCloudflare:
		return cloudflare.NewDNSProvider()
	case ProviderRoute53:
		return route53.NewDNSProvider()
	case ProviderDuckDNS:
		return duckdns.NewDNSProvider()
	case ProviderNamecheap:
		return namecheap.NewDNSProvider()
	case ProviderSimply:
		return simply.NewDNSProvider()
	default:
		return nil, fmt.Errorf("unsupported DNS provider: %q (supported: cloudflare, route53, duckdns, namecheap, simply)", m.cfg.Provider)
	}
}

// Certificate caching

func (m *Manager) certPath() string { return filepath.Join(m.cfg.CertsDir, "cert.pem") }
func (m *Manager) keyPath() string  { return filepath.Join(m.cfg.CertsDir, "key.pem") }

func (m *Manager) saveCert(cert *certificate.Resource) error {
	if err := os.WriteFile(m.certPath(), cert.Certificate, 0644); err != nil {
		return err
	}
	return os.WriteFile(m.keyPath(), cert.PrivateKey, 0600)
}

func (m *Manager) loadCached() error {
	tlsCert, err := tls.LoadX509KeyPair(m.certPath(), m.keyPath())
	if err != nil {
		return err
	}
	// Parse the leaf so we can check expiry
	if len(tlsCert.Certificate) > 0 {
		leaf, err := x509.ParseCertificate(tlsCert.Certificate[0])
		if err == nil {
			tlsCert.Leaf = leaf
			// Don't use expired certificates
			if time.Now().After(leaf.NotAfter) {
				return fmt.Errorf("cached certificate expired at %s", leaf.NotAfter)
			}
		}
	}
	m.mu.Lock()
	m.cert = &tlsCert
	m.mu.Unlock()
	return nil
}

// Account persistence

func (m *Manager) accountKeyPath() string  { return filepath.Join(m.cfg.CertsDir, "account.key") }
func (m *Manager) accountDataPath() string { return filepath.Join(m.cfg.CertsDir, "account.json") }

func (m *Manager) loadOrCreateAccount() (*legoUser, error) {
	user := &legoUser{email: m.cfg.Email}

	// Try loading existing key
	keyData, err := os.ReadFile(m.accountKeyPath())
	if err == nil {
		block, _ := pem.Decode(keyData)
		if block != nil {
			key, err := x509.ParseECPrivateKey(block.Bytes)
			if err == nil {
				user.key = key
			}
		}
	}

	// Generate new key if needed
	if user.key == nil {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, err
		}
		user.key = key

		// Persist the key
		keyBytes, err := x509.MarshalECPrivateKey(key)
		if err != nil {
			return nil, err
		}
		keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes})
		os.WriteFile(m.accountKeyPath(), keyPEM, 0600)
	}

	// Try loading registration
	regData, err := os.ReadFile(m.accountDataPath())
	if err == nil {
		var reg registration.Resource
		if json.Unmarshal(regData, &reg) == nil {
			user.reg = &reg
		}
	}

	return user, nil
}

func (m *Manager) saveAccount(user *legoUser) {
	if user.reg == nil {
		return
	}
	data, err := json.Marshal(user.reg)
	if err != nil {
		return
	}
	os.WriteFile(m.accountDataPath(), data, 0600)
}
