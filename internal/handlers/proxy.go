package handlers

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ProxyHandler reverse-proxies all requests to an external BabyTracker instance.
// Used in HA add-on external mode.
type ProxyHandler struct {
	target *url.URL
	client *http.Client
}

func NewProxyHandler(targetURL string) (*ProxyHandler, error) {
	u, err := url.Parse(targetURL)
	if err != nil {
		return nil, err
	}
	// Ensure trailing slash
	if !strings.HasSuffix(u.Path, "/") {
		u.Path += "/"
	}

	return &ProxyHandler{
		target: u,
		client: &http.Client{
			Timeout: 60 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse // Don't follow redirects
			},
		},
	}, nil
}

func (h *ProxyHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Build target URL
	targetURL := *h.target
	targetURL.Path = strings.TrimSuffix(targetURL.Path, "/") + r.URL.Path
	targetURL.RawQuery = r.URL.RawQuery

	// Handle X-Ingress-Path: strip it from the path before proxying
	if ingressPath := r.Header.Get("X-Ingress-Path"); ingressPath != "" {
		path := r.URL.Path
		path = strings.TrimPrefix(path, ingressPath)
		if path == "" {
			path = "/"
		}
		targetURL.Path = strings.TrimSuffix(h.target.Path, "/") + path
	}

	// Create proxy request
	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL.String(), r.Body)
	if err != nil {
		http.Error(w, "proxy error", http.StatusBadGateway)
		return
	}

	// Copy headers (except Host)
	for key, values := range r.Header {
		if strings.EqualFold(key, "Host") {
			continue
		}
		for _, v := range values {
			proxyReq.Header.Add(key, v)
		}
	}

	// Forward cookies
	for _, cookie := range r.Cookies() {
		proxyReq.AddCookie(cookie)
	}

	// Execute
	resp, err := h.client.Do(proxyReq)
	if err != nil {
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for key, values := range resp.Header {
		for _, v := range values {
			w.Header().Add(key, v)
		}
	}

	// Copy status and body
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
