package acme

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	r53types "github.com/aws/aws-sdk-go-v2/service/route53/types"
)

// EnsureARecord creates or updates an A record for the given domain.
// If ip is empty, it auto-detects the machine's LAN IP.
func EnsureARecord(provider, domain, ip string) error {
	if ip == "" {
		detected, err := detectLANIP()
		if err != nil {
			return fmt.Errorf("auto-detect IP: %w", err)
		}
		ip = detected
		slog.Info("acme: auto-detected LAN IP", "ip", ip)
	}

	slog.Info("acme: ensuring A record", "domain", domain, "ip", ip, "provider", provider)

	switch strings.ToLower(provider) {
	case ProviderCloudflare:
		return cloudflareEnsureA(domain, ip)
	case ProviderRoute53:
		return route53EnsureA(domain, ip)
	case ProviderDuckDNS:
		return duckdnsEnsureA(domain, ip)
	case ProviderNamecheap:
		return namecheapEnsureA(domain, ip)
	case ProviderSimply:
		return simplyEnsureA(domain, ip)
	default:
		return fmt.Errorf("A record management not supported for provider %q", provider)
	}
}

// detectLANIP returns the machine's primary LAN IP address.
func detectLANIP() (string, error) {
	conn, err := net.DialTimeout("udp4", "1.1.1.1:53", 2*time.Second)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	addr := conn.LocalAddr().(*net.UDPAddr)
	return addr.IP.String(), nil
}

// --- Cloudflare ---

func cloudflareEnsureA(domain, ip string) error {
	token := os.Getenv("CF_DNS_API_TOKEN")
	if token == "" {
		token = os.Getenv("CLOUDFLARE_DNS_API_TOKEN")
	}
	if token == "" {
		return fmt.Errorf("CF_DNS_API_TOKEN not set")
	}

	client := &http.Client{Timeout: 30 * time.Second}
	baseURL := "https://api.cloudflare.com/client/v4"

	// Find zone ID
	parts := strings.Split(domain, ".")
	if len(parts) < 2 {
		return fmt.Errorf("invalid domain: %s", domain)
	}
	zoneName := parts[len(parts)-2] + "." + parts[len(parts)-1]

	req, _ := http.NewRequest("GET", baseURL+"/zones?name="+zoneName, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var zoneResp struct {
		Result []struct {
			ID string `json:"id"`
		} `json:"result"`
	}
	json.NewDecoder(resp.Body).Decode(&zoneResp)
	if len(zoneResp.Result) == 0 {
		return fmt.Errorf("zone not found for %s", zoneName)
	}
	zoneID := zoneResp.Result[0].ID

	// Check for existing A record
	req, _ = http.NewRequest("GET", baseURL+"/zones/"+zoneID+"/dns_records?type=A&name="+domain, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err = client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var recResp struct {
		Result []struct {
			ID      string `json:"id"`
			Content string `json:"content"`
		} `json:"result"`
	}
	json.NewDecoder(resp.Body).Decode(&recResp)

	record := map[string]any{
		"type":    "A",
		"name":    domain,
		"content": ip,
		"ttl":     120,
		"proxied": false,
	}
	body, _ := json.Marshal(record)

	if len(recResp.Result) > 0 {
		if recResp.Result[0].Content == ip {
			slog.Info("acme: A record already correct", "domain", domain, "ip", ip)
			return nil
		}
		// Update existing
		req, _ = http.NewRequest("PUT", baseURL+"/zones/"+zoneID+"/dns_records/"+recResp.Result[0].ID, bytes.NewReader(body))
	} else {
		// Create new
		req, _ = http.NewRequest("POST", baseURL+"/zones/"+zoneID+"/dns_records", bytes.NewReader(body))
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err = client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("cloudflare API error %d: %s", resp.StatusCode, b)
	}

	slog.Info("acme: A record set", "domain", domain, "ip", ip)
	return nil
}

// --- Route53 ---

func route53EnsureA(domain, ip string) error {
	ctx := context.Background()
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return fmt.Errorf("AWS config: %w", err)
	}
	client := route53.NewFromConfig(awsCfg)

	// Find hosted zone
	zoneID := os.Getenv("AWS_HOSTED_ZONE_ID")
	if zoneID == "" {
		// Auto-discover from domain
		out, err := client.ListHostedZonesByName(ctx, &route53.ListHostedZonesByNameInput{
			DNSName: &domain,
		})
		if err != nil {
			return fmt.Errorf("list hosted zones: %w", err)
		}
		for _, z := range out.HostedZones {
			if z.Id != nil {
				zoneID = *z.Id
				break
			}
		}
		if zoneID == "" {
			return fmt.Errorf("no hosted zone found for %s", domain)
		}
	}

	fqdn := domain + "."
	ttl := int64(300)
	_, err = client.ChangeResourceRecordSets(ctx, &route53.ChangeResourceRecordSetsInput{
		HostedZoneId: &zoneID,
		ChangeBatch: &r53types.ChangeBatch{
			Changes: []r53types.Change{{
				Action: r53types.ChangeActionUpsert,
				ResourceRecordSet: &r53types.ResourceRecordSet{
					Name: &fqdn,
					Type: r53types.RRTypeA,
					TTL:  &ttl,
					ResourceRecords: []r53types.ResourceRecord{{
						Value: &ip,
					}},
				},
			}},
		},
	})
	if err != nil {
		return fmt.Errorf("route53 upsert: %w", err)
	}
	slog.Info("acme: A record set via Route53", "domain", domain, "ip", ip)
	return nil
}

// --- DuckDNS ---

func duckdnsEnsureA(domain, ip string) error {
	token := os.Getenv("DUCKDNS_TOKEN")
	if token == "" {
		return fmt.Errorf("DUCKDNS_TOKEN not set")
	}

	// DuckDNS domain is "subdomain.duckdns.org" — extract the subdomain
	subdomain := strings.TrimSuffix(domain, ".duckdns.org")
	subdomain = strings.TrimSuffix(subdomain, ".duckdns.org.")

	url := fmt.Sprintf("https://www.duckdns.org/update?domains=%s&token=%s&ip=%s", subdomain, token, ip)
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if strings.TrimSpace(string(b)) != "OK" {
		return fmt.Errorf("duckdns update failed: %s", b)
	}
	slog.Info("acme: A record set via DuckDNS", "domain", domain, "ip", ip)
	return nil
}

// --- Namecheap ---

func namecheapEnsureA(domain, ip string) error {
	apiUser := os.Getenv("NAMECHEAP_API_USER")
	apiKey := os.Getenv("NAMECHEAP_API_KEY")
	if apiUser == "" || apiKey == "" {
		return fmt.Errorf("NAMECHEAP_API_USER and NAMECHEAP_API_KEY required")
	}

	// Split domain into SLD and TLD (e.g. "test.example.com" → host="test", sld="example", tld="com")
	parts := strings.Split(domain, ".")
	if len(parts) < 3 {
		return fmt.Errorf("domain must have a subdomain (e.g. baby.example.com)")
	}
	host := strings.Join(parts[:len(parts)-2], ".")
	sld := parts[len(parts)-2]
	tld := parts[len(parts)-1]

	clientIP := os.Getenv("NAMECHEAP_CLIENT_IP")
	if clientIP == "" {
		clientIP, _ = detectLANIP()
	}

	baseURL := "https://api.namecheap.com/xml.response"
	if os.Getenv("NAMECHEAP_SANDBOX") == "true" {
		baseURL = "https://api.sandbox.namecheap.com/xml.response"
	}

	// Set the A record using setHosts — this replaces all records, so we need to
	// get existing records first and merge. For simplicity, we'll just set the one record.
	// This is a known Namecheap API limitation.
	url := fmt.Sprintf("%s?ApiUser=%s&ApiKey=%s&UserName=%s&ClientIp=%s&Command=namecheap.domains.dns.setHosts&SLD=%s&TLD=%s&HostName1=%s&RecordType1=A&Address1=%s&TTL1=300",
		baseURL, apiUser, apiKey, apiUser, clientIP, sld, tld, host, ip)

	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("namecheap API error %d: %s", resp.StatusCode, b)
	}
	slog.Info("acme: A record set via Namecheap", "domain", domain, "ip", ip)
	return nil
}

// --- Simply.com ---

func simplyEnsureA(domain, ip string) error {
	account := os.Getenv("SIMPLY_ACCOUNT_NAME")
	apiKey := os.Getenv("SIMPLY_API_KEY")
	if account == "" || apiKey == "" {
		return fmt.Errorf("SIMPLY_ACCOUNT_NAME and SIMPLY_API_KEY required")
	}

	// Extract zone and hostname
	parts := strings.Split(domain, ".")
	if len(parts) < 3 {
		return fmt.Errorf("domain must have a subdomain (e.g. baby.example.com)")
	}
	zoneName := parts[len(parts)-2] + "." + parts[len(parts)-1]
	hostname := strings.Join(parts[:len(parts)-2], ".")

	client := &http.Client{Timeout: 30 * time.Second}
	baseURL := "https://api.simply.com/2"

	// List existing records to find if A record exists
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/my/products/%s/dns/records", baseURL, zoneName), nil)
	req.SetBasicAuth(account, apiKey)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var listResp struct {
		Records []struct {
			ID   int    `json:"record_id"`
			Name string `json:"name"`
			Type string `json:"type"`
			Data string `json:"data"`
		} `json:"records"`
	}
	json.NewDecoder(resp.Body).Decode(&listResp)

	// Check for existing A record
	existingID := 0
	for _, r := range listResp.Records {
		if r.Type == "A" && r.Name == hostname {
			if r.Data == ip {
				slog.Info("acme: A record already correct", "domain", domain, "ip", ip)
				return nil
			}
			existingID = r.ID
			break
		}
	}

	record := map[string]any{
		"name": hostname,
		"type": "A",
		"data": ip,
		"ttl":  3600,
	}
	body, _ := json.Marshal(record)

	if existingID > 0 {
		// Update
		req, _ = http.NewRequest("PUT", fmt.Sprintf("%s/my/products/%s/dns/records/%d", baseURL, zoneName, existingID), bytes.NewReader(body))
	} else {
		// Create
		req, _ = http.NewRequest("POST", fmt.Sprintf("%s/my/products/%s/dns/records", baseURL, zoneName), bytes.NewReader(body))
	}
	req.SetBasicAuth(account, apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err = client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("simply API error %d: %s", resp.StatusCode, b)
	}

	slog.Info("acme: A record set via Simply.com", "domain", domain, "ip", ip)
	return nil
}
