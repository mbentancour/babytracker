package acme

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSimplyEnsureAResolvesProduct(t *testing.T) {
	var requests []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Errorf("unexpected Authorization header %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/my/products/" {
			json.NewEncoder(w).Encode(map[string]any{"products": []map[string]any{
				{"object": "kvolbæk.dk", "domain": map[string]any{"name": "kvolbæk.dk", "name_idn": "xn--kvolbk-tua.dk"}},
				{"object": "example.com", "domain": map[string]any{"name": "example.com", "name_idn": "example.com"}},
				{"object": "www.example.com", "domain": map[string]any{"name": "www.example.com", "name_idn": "www.example.com"}},
			}})
			return
		}
		body, _ := io.ReadAll(r.Body)
		requests = append(requests, strings.TrimSpace(r.Method+" "+r.RequestURI+" "+string(body)))
		if r.Method == http.MethodGet && r.URL.Path == "/my/products/www.example.com/dns/records/" {
			json.NewEncoder(w).Encode(map[string]any{"records": []map[string]any{
				{"record_id": 5, "name": "baby", "type": "A", "data": "192.0.2.1"},
			}})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"records": []any{}})
	}))
	defer server.Close()

	originalURL := simplyBaseURL
	simplyBaseURL = server.URL
	defer func() { simplyBaseURL = originalURL }()

	creds := map[string]string{"SIMPLY_API_KEY": "secret"}
	if err := simplyEnsureA("Baby.XN--KVOLBK-TUA.DK", "192.0.2.10", creds); err != nil {
		t.Fatalf("IDN domain: %v", err)
	}
	if err := simplyEnsureA("baby.www.example.com.", "192.0.2.11", creds); err != nil {
		t.Fatalf("subdomain product: %v", err)
	}

	expected := []string{
		"GET /my/products/kvolb%C3%A6k.dk/dns/records/",
		`POST /my/products/kvolb%C3%A6k.dk/dns/records/ {"data":"192.0.2.10","name":"baby","ttl":3600,"type":"A"}`,
		"GET /my/products/www.example.com/dns/records/",
		`PUT /my/products/www.example.com/dns/records/5/ {"data":"192.0.2.11","name":"baby","ttl":3600,"type":"A"}`,
	}
	if strings.Join(requests, "\n") != strings.Join(expected, "\n") {
		t.Errorf("requests:\n%s\nwant:\n%s", strings.Join(requests, "\n"), strings.Join(expected, "\n"))
	}

	if err := simplyEnsureA("baby.unknown.dk", "192.0.2.12", creds); err == nil {
		t.Error("expected error for a domain without a product")
	}
	if err := simplyEnsureA("www.example.com", "192.0.2.13", creds); err == nil {
		t.Error("expected error for a domain that is a product itself")
	}
}
