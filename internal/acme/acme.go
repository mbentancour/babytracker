// Package acme provides ACME certificate management with DNS-01 challenge support.
// It wraps the lego library to obtain and renew Let's Encrypt certificates using
// DNS providers (Cloudflare, Route53, DuckDNS, Namecheap, Simply.com).
package acme

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/go-acme/lego/v4/certcrypto"
	"github.com/go-acme/lego/v4/certificate"
	"github.com/go-acme/lego/v4/challenge"
	"github.com/go-acme/lego/v4/lego"
	"github.com/go-acme/lego/v4/providers/dns/cloudflare"
	"github.com/go-acme/lego/v4/providers/dns/duckdns"
	"github.com/go-acme/lego/v4/providers/dns/namecheap"
	"github.com/go-acme/lego/v4/providers/dns/route53"
	"github.com/go-acme/lego/v4/providers/dns/simply"
	"github.com/go-acme/lego/v4/registration"
)

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
}

// Manager handles certificate issuance, renewal, and TLS config.
type Manager struct {
	cfg  Config
	mu   sync.RWMutex
	cert *tls.Certificate
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

// Run obtains a certificate (or loads a cached one) and starts a background
// goroutine that renews it before expiry. This method blocks until the initial
// certificate is ready, then returns.
func (m *Manager) Run() error {
	os.MkdirAll(m.cfg.CertsDir, 0700)

	// Try loading a cached certificate first
	if err := m.loadCached(); err == nil {
		slog.Info("acme: loaded cached certificate", "domain", m.cfg.Domain)
	} else {
		slog.Info("acme: no cached certificate, obtaining new one", "domain", m.cfg.Domain)
		if err := m.obtain(); err != nil {
			return fmt.Errorf("acme: failed to obtain certificate: %w", err)
		}
	}

	// Start renewal loop
	go m.renewLoop()
	return nil
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

func (m *Manager) renewLoop() {
	for {
		m.mu.RLock()
		cert := m.cert
		m.mu.RUnlock()

		if cert == nil {
			time.Sleep(time.Minute)
			continue
		}

		// Parse the leaf certificate to check expiry
		leaf := cert.Leaf
		if leaf == nil && len(cert.Certificate) > 0 {
			parsed, err := x509.ParseCertificate(cert.Certificate[0])
			if err == nil {
				leaf = parsed
			}
		}

		if leaf == nil {
			time.Sleep(time.Hour)
			continue
		}

		// Renew when less than 30 days remain
		renewAt := leaf.NotAfter.Add(-30 * 24 * time.Hour)
		sleepDur := time.Until(renewAt)
		if sleepDur > 0 {
			slog.Info("acme: certificate valid, next renewal check",
				"domain", m.cfg.Domain,
				"expires", leaf.NotAfter,
				"renew_at", renewAt,
			)
			time.Sleep(sleepDur)
		}

		slog.Info("acme: renewing certificate", "domain", m.cfg.Domain)
		if err := m.obtain(); err != nil {
			slog.Error("acme: renewal failed, retrying in 1 hour", "error", err)
			time.Sleep(time.Hour)
		} else {
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
	if err := client.Challenge.SetDNS01Provider(provider); err != nil {
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
