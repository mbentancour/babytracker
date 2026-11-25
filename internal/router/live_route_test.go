package router

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/models"
)

// A screen listening on /api/events hears about a change made through the
// API, and about nothing else.
func TestLiveEventsFollowWrites(t *testing.T) {
	db := routerTestDB(t)
	cfg, token := importTestAdmin(t, db)
	srv := httptest.NewServer(New(db, cfg))
	defer srv.Close()

	// The stream is authenticated by the refresh-token cookie.
	var adminID int
	if err := db.Get(&adminID, `SELECT id FROM users WHERE username = 'admin'`); err != nil {
		t.Fatal(err)
	}
	refresh, err := crypto.GenerateRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if err := models.CreateRefreshToken(db, adminID, crypto.HashRefreshToken(refresh), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	// Without the cookie there is no stream.
	if resp, err := http.Get(srv.URL + "/api/events"); err != nil {
		t.Fatal(err)
	} else {
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("GET /api/events without a cookie = %d, want 401", resp.StatusCode)
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/events", nil)
	req.AddCookie(&http.Cookie{Name: "refresh_token", Value: refresh})
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("GET /api/events = %d %q, want 200 text/event-stream", resp.StatusCode, resp.Header.Get("Content-Type"))
	}

	messages := make(chan string, 16)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			if line := scanner.Text(); strings.HasPrefix(line, "data: ") {
				messages <- strings.TrimPrefix(line, "data: ")
			}
		}
		close(messages)
	}()
	next := func(wait time.Duration) (string, bool) {
		select {
		case m, ok := <-messages:
			return m, ok
		case <-time.After(wait):
			return "", false
		}
	}
	if m, ok := next(5 * time.Second); !ok || m != `{"connected":true}` {
		t.Fatalf("first message = %q (%v), want the connected message", m, ok)
	}

	do := func(method, path, body string) int {
		t.Helper()
		r, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}

	// Reading changes nothing, so it says nothing.
	if code := do(http.MethodGet, "/api/children/", ""); code != http.StatusOK {
		t.Fatalf("GET /api/children/ = %d", code)
	}
	// Neither does a write that was refused.
	if code := do(http.MethodPost, "/api/children/", `{"first_name":""}`); code < 400 {
		t.Fatalf("POST of an invalid child = %d, want an error", code)
	}
	// Nor signing in or refreshing a token, which every screen does on its own.
	do(http.MethodPost, "/api/auth/refresh", `{}`)
	if m, ok := next(400 * time.Millisecond); ok {
		t.Fatalf("got %q after requests that changed nothing", m)
	}

	// A successful write does.
	if code := do(http.MethodPost, "/api/children/", `{"first_name":"Rosa","birth_date":"2026-01-01"}`); code != http.StatusCreated && code != http.StatusOK {
		t.Fatalf("POST /api/children/ = %d", code)
	}
	if m, ok := next(5 * time.Second); !ok || m != `{"changed":true}` {
		t.Fatalf("after a write got %q (%v), want the changed message", m, ok)
	}
}
