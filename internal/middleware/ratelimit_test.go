package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRateLimitBlocksAfterMax(t *testing.T) {
	handler := RateLimit(3, time.Minute)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for i := 1; i <= 3; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
		req.RemoteAddr = "10.0.0.1:5000"
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: want 200, got %d", i, rec.Code)
		}
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	req.RemoteAddr = "10.0.0.1:5000"
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("want 429 after limit, got %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After header on 429")
	}
}

// Successive connections from the same client come from different source
// ports; they must share one bucket or the limit is trivially bypassed.
func TestRateLimitIgnoresSourcePort(t *testing.T) {
	handler := RateLimit(1, time.Minute)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "10.0.0.2:1111"
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first request: want 200, got %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "10.0.0.2:2222" // same IP, new port
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("same IP on new port got fresh quota: want 429, got %d", rec.Code)
	}
}

func TestRateLimitPerIPIsolation(t *testing.T) {
	handler := RateLimit(1, time.Minute)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "10.0.0.3:1111"
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first IP: want 200, got %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "10.0.0.4:1111"
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("second IP throttled by first IP's quota: want 200, got %d", rec.Code)
	}
}

func TestRateLimitWindowExpiry(t *testing.T) {
	rl := newRateLimiter(1, 30*time.Millisecond)

	if !rl.allow("10.0.0.5") {
		t.Fatal("first attempt should be allowed")
	}
	if rl.allow("10.0.0.5") {
		t.Fatal("second attempt inside window should be blocked")
	}

	time.Sleep(40 * time.Millisecond)
	if !rl.allow("10.0.0.5") {
		t.Fatal("attempt after window expiry should be allowed")
	}
}
