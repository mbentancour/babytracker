package router

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/models"
)

// liveOpen opens /api/events, signed in however signIn marks the request. It
// returns a function that waits for the stream's next message, and a channel
// that is closed once the stream is over. The message saying the stream is
// open has already been read when this returns.
func liveOpen(t *testing.T, srv *httptest.Server, signIn func(*http.Request)) (func(wait time.Duration) (string, bool), <-chan struct{}) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/events", nil)
	signIn(req)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("GET /api/events = %d %q, want 200 text/event-stream", resp.StatusCode, resp.Header.Get("Content-Type"))
	}

	messages := make(chan string, 16)
	ended := make(chan struct{})
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			if line := scanner.Text(); strings.HasPrefix(line, "data: ") {
				messages <- strings.TrimPrefix(line, "data: ")
			}
		}
		close(messages)
		close(ended)
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
	return next, ended
}

// sessionCookie gives userID a session, as signing in does, and returns the
// refresh-token cookie a browser would hold for it.
func sessionCookie(t *testing.T, db *sqlx.DB, userID int) *http.Cookie {
	t.Helper()
	refresh, err := crypto.GenerateRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	if err := models.CreateRefreshToken(db, userID, crypto.HashRefreshToken(refresh), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: "refresh_token", Value: refresh}
}

// liveStream opens /api/events as one of userID's screens, signed in the way
// a browser normally is: by the refresh-token cookie.
func liveStream(t *testing.T, srv *httptest.Server, db *sqlx.DB, userID int) func(wait time.Duration) (string, bool) {
	t.Helper()
	cookie := sessionCookie(t, db, userID)
	next, _ := liveOpen(t, srv, func(r *http.Request) { r.AddCookie(cookie) })
	return next
}

// accessTokenLasting signs an access token like the ones the server issues,
// except that it expires `lifetime` from now (already, when that is
// negative). It also returns the moment it expires: JWT counts in whole
// seconds, so that can be up to a second sooner than asked for.
func accessTokenLasting(t *testing.T, secret string, userID int, username string, lifetime time.Duration) (string, time.Time) {
	t.Helper()
	expires := jwt.NewNumericDate(time.Now().Add(lifetime))
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, crypto.Claims{
		UserID:   userID,
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: expires,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "babytracker",
		},
	}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return token, expires.Time
}

// liveRequest sends an API request to the running server as the holder of
// token and returns the status and the decoded JSON reply, if there was one.
func liveRequest(t *testing.T, srv *httptest.Server, token, method, path, body string) (int, map[string]any) {
	t.Helper()
	r, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

// A screen listening on /api/events hears about a change made through the
// API, and about nothing else.
func TestLiveEventsFollowWrites(t *testing.T) {
	db := routerTestDB(t)
	cfg, token := importTestAdmin(t, db)
	srv := httptest.NewServer(New(db, cfg))
	// Registered before any stream is opened, so it runs after their own
	// cleanups: Close waits for open requests, and a stream never ends by itself.
	t.Cleanup(srv.Close)

	var adminID int
	if err := db.Get(&adminID, `SELECT id FROM users WHERE username = 'admin'`); err != nil {
		t.Fatal(err)
	}

	// Without signing in there is no stream.
	if resp, err := http.Get(srv.URL + "/api/events"); err != nil {
		t.Fatal(err)
	} else {
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("GET /api/events without a cookie or a token = %d, want 401", resp.StatusCode)
		}
	}

	next := liveStream(t, srv, db, adminID)
	do := func(method, path, body string) int {
		t.Helper()
		code, _ := liveRequest(t, srv, token, method, path, body)
		return code
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

// A change to one child's data wakes the screens of the people who can see
// that child, admins among them, and nobody else's. A change that is not
// about one child wakes everyone.
func TestLiveEventsReachThoseWhoCanSeeTheChild(t *testing.T) {
	db := routerTestDB(t)
	cfg, adminToken := importTestAdmin(t, db)
	srv := httptest.NewServer(New(db, cfg))
	// Registered before any stream is opened, so it runs after their own
	// cleanups: Close waits for open requests, and a stream never ends by itself.
	t.Cleanup(srv.Close)

	var adminID int
	if err := db.Get(&adminID, `SELECT id FROM users WHERE username = 'admin'`); err != nil {
		t.Fatal(err)
	}
	child := func(name string) int {
		t.Helper()
		code, out := liveRequest(t, srv, adminToken, http.MethodPost, "/api/children/", `{"first_name":"`+name+`","birth_date":"2026-01-01"}`)
		id, _ := out["id"].(float64)
		if (code != http.StatusCreated && code != http.StatusOK) || id == 0 {
			t.Fatalf("POST /api/children/ for %s = %d %v", name, code, out)
		}
		return int(id)
	}
	rosa, theo := child("Rosa"), child("Theo")

	// Nora may only look at Rosa; Omar looks after Theo.
	user := func(name string, childID int, role string) (int, string) {
		t.Helper()
		var id int
		if err := db.Get(&id, `INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', false) RETURNING id`, name); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO user_children (user_id, child_id, role_id) SELECT $1, $2, id FROM roles WHERE name = $3`, id, childID, role); err != nil {
			t.Fatal(err)
		}
		token, err := crypto.GenerateAccessToken(cfg.JWTSecret, id, name, false)
		if err != nil {
			t.Fatal(err)
		}
		return id, token
	}
	noraID, _ := user("nora", rosa, "viewer")
	omarID, omarToken := user("omar", theo, "parent")

	screens := map[string]func(time.Duration) (string, bool){
		"the admin": liveStream(t, srv, db, adminID),
		"Nora":      liveStream(t, srv, db, noraID),
		"Omar":      liveStream(t, srv, db, omarID),
	}
	// expect checks that exactly these screens are told about what was just
	// done: each of them gets the message, the others get nothing.
	expect := func(what string, woken ...string) {
		t.Helper()
		told := map[string]bool{}
		for _, name := range woken {
			told[name] = true
			if m, ok := screens[name](5 * time.Second); !ok || m != `{"changed":true}` {
				t.Errorf("%s: %s's screen got %q (%v), want the changed message", what, name, m, ok)
			}
		}
		for name, next := range screens {
			if told[name] {
				continue
			}
			if m, ok := next(300 * time.Millisecond); ok {
				t.Errorf("%s: %s's screen got %q, want nothing", what, name, m)
			}
		}
	}
	entry := func(what string, code int, out map[string]any) string {
		t.Helper()
		id, _ := out["id"].(float64)
		if (code != http.StatusCreated && code != http.StatusOK) || id == 0 {
			t.Fatalf("%s = %d %v", what, code, out)
		}
		return itoa(int(id))
	}

	// A create names its child in the body. The admin's write has to be
	// noticed although an admin's requests skip the access checks.
	code, out := liveRequest(t, srv, adminToken, http.MethodPost, "/api/feedings/",
		`{"child":`+itoa(rosa)+`,"start":"2026-01-02T08:00:00","end":"2026-01-02T08:15:00","type":"breast milk","method":"bottle","amount":120}`)
	feeding := entry("POST /api/feedings/", code, out)
	expect("a feed logged for Rosa", "the admin", "Nora")

	// An update and a delete name only the record; whose it is comes from
	// the record itself.
	if code, _ := liveRequest(t, srv, adminToken, http.MethodPatch, "/api/feedings/"+feeding+"/", `{"amount":130}`); code != http.StatusOK {
		t.Fatalf("PATCH /api/feedings/%s/ = %d", feeding, code)
	}
	expect("Rosa's feed changed", "the admin", "Nora")
	if code, _ := liveRequest(t, srv, adminToken, http.MethodDelete, "/api/feedings/"+feeding+"/", ""); code != http.StatusNoContent {
		t.Fatalf("DELETE /api/feedings/%s/ = %d", feeding, code)
	}
	expect("Rosa's feed deleted", "the admin", "Nora")

	// The same for someone who is not an admin, and for the other child.
	code, out = liveRequest(t, srv, omarToken, http.MethodPost, "/api/changes/",
		`{"child":`+itoa(theo)+`,"time":"2026-01-02T09:00:00","wet":true,"solid":false}`)
	diaper := entry("POST /api/changes/", code, out)
	expect("a diaper logged for Theo", "the admin", "Omar")
	if code, _ := liveRequest(t, srv, omarToken, http.MethodPatch, "/api/changes/"+diaper+"/", `{"solid":true}`); code != http.StatusOK {
		t.Fatalf("PATCH /api/changes/%s/ = %d", diaper, code)
	}
	expect("Theo's diaper changed", "the admin", "Omar")

	// A setting belongs to no child, so everyone hears of it.
	if code, _ := liveRequest(t, srv, adminToken, http.MethodPut, "/api/settings/ui", `{"ui":"simple"}`); code != http.StatusOK {
		t.Fatalf("PUT /api/settings/ui = %d", code)
	}
	expect("a setting changed", "the admin", "Nora", "Omar")

	// So does everyone when the list of children itself changes.
	if code, _ := liveRequest(t, srv, adminToken, http.MethodPatch, "/api/children/"+itoa(rosa)+"/", `{"first_name":"Rosalind"}`); code != http.StatusOK {
		t.Fatalf("PATCH /api/children/%d/ = %d", rosa, code)
	}
	expect("Rosa renamed", "the admin", "Nora", "Omar")
}

// A browser that could not keep the session cookie (inside the Home Assistant
// panel it is often dropped) still gets the stream, signed in by nothing but
// its access token, and is woken for exactly what that user may see.
func TestLiveEventsWithAnAccessToken(t *testing.T) {
	db := routerTestDB(t)
	cfg, adminToken := importTestAdmin(t, db)
	srv := httptest.NewServer(New(db, cfg))
	// Registered before any stream is opened, so it runs after their own
	// cleanups: Close waits for open requests, and a stream never ends by itself.
	t.Cleanup(srv.Close)

	child := func(name string) int {
		t.Helper()
		code, out := liveRequest(t, srv, adminToken, http.MethodPost, "/api/children/", `{"first_name":"`+name+`","birth_date":"2026-01-01"}`)
		id, _ := out["id"].(float64)
		if (code != http.StatusCreated && code != http.StatusOK) || id == 0 {
			t.Fatalf("POST /api/children/ for %s = %d %v", name, code, out)
		}
		return int(id)
	}
	rosa, theo := child("Rosa"), child("Theo")

	// Nora may only look at Rosa. She has no session row at all: the access
	// token is the only sign-in there is.
	var noraID int
	if err := db.Get(&noraID, `INSERT INTO users (username, password_hash, is_admin) VALUES ('nora', 'x', false) RETURNING id`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO user_children (user_id, child_id, role_id) SELECT $1, $2, id FROM roles WHERE name = 'viewer'`, noraID, rosa); err != nil {
		t.Fatal(err)
	}
	noraToken, err := crypto.GenerateAccessToken(cfg.JWTSecret, noraID, "nora", false)
	if err != nil {
		t.Fatal(err)
	}
	bearer := func(token string) func(*http.Request) {
		return func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+token) }
	}

	next, _ := liveOpen(t, srv, bearer(noraToken))
	log := func(what, path, body string) {
		t.Helper()
		if code, out := liveRequest(t, srv, adminToken, http.MethodPost, path, body); code != http.StatusCreated {
			t.Fatalf("%s = %d %v", what, code, out)
		}
	}
	log("a feed for Rosa", "/api/feedings/",
		`{"child":`+itoa(rosa)+`,"start":"2026-01-02T08:00:00","end":"2026-01-02T08:15:00","type":"breast milk","method":"bottle","amount":120}`)
	if m, ok := next(5 * time.Second); !ok || m != `{"changed":true}` {
		t.Errorf("a feed logged for Rosa: Nora's screen got %q (%v), want the changed message", m, ok)
	}
	log("a diaper for Theo", "/api/changes/", `{"child":`+itoa(theo)+`,"time":"2026-01-02T09:00:00","wet":true,"solid":false}`)
	if m, ok := next(300 * time.Millisecond); ok {
		t.Errorf("a diaper logged for Theo: Nora's screen got %q, want nothing", m)
	}

	// Inside the panel the browser can also go on presenting a cookie whose
	// session has since been replaced. That must not stand in the token's way.
	stale := &http.Cookie{Name: "refresh_token", Value: "left-over-from-an-earlier-session"}
	liveOpen(t, srv, func(r *http.Request) {
		r.AddCookie(stale)
		r.Header.Set("Authorization", "Bearer "+noraToken)
	})

	// Anything short of a token the server signed and that has not run out
	// is no sign-in.
	forged, _ := accessTokenLasting(t, "somebody-else's-secret", noraID, "nora", time.Hour)
	expired, _ := accessTokenLasting(t, cfg.JWTSecret, noraID, "nora", -time.Minute)
	for _, c := range []struct{ name, header string }{
		{"something that is not a token", "Bearer not-a-token"},
		{"a token signed with another secret", "Bearer " + forged},
		{"a token that has expired", "Bearer " + expired},
		{"a good token under another scheme", "Basic " + noraToken},
		{"a good token with no scheme", noraToken},
	} {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/events", nil)
		req.Header.Set("Authorization", c.header)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("GET /api/events with %s = %d, want 401", c.name, resp.StatusCode)
		}
	}
}

// A stream signed in by access token ends when the token does, so it cannot
// outlive the sign-in it was opened with; the client opens the next one with
// its next token. A stream signed in by the cookie stays open.
func TestLiveEventsEndWithTheAccessToken(t *testing.T) {
	db := routerTestDB(t)
	cfg, _ := importTestAdmin(t, db)
	srv := httptest.NewServer(New(db, cfg))
	t.Cleanup(srv.Close)

	var adminID int
	if err := db.Get(&adminID, `SELECT id FROM users WHERE username = 'admin'`); err != nil {
		t.Fatal(err)
	}

	cookie := sessionCookie(t, db, adminID)
	_, cookieEnded := liveOpen(t, srv, func(r *http.Request) { r.AddCookie(cookie) })

	token, expires := accessTokenLasting(t, cfg.JWTSecret, adminID, "admin", 3*time.Second)
	_, tokenEnded := liveOpen(t, srv, func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+token) })

	select {
	case <-tokenEnded:
		if early := time.Until(expires); early > 0 {
			t.Fatalf("the token's stream ended %v before the token did", early)
		}
	case <-time.After(time.Until(expires) + 5*time.Second):
		t.Fatal("the token's stream was still open 5 seconds after the token expired")
	}

	select {
	case <-cookieEnded:
		t.Fatal("the cookie's stream ended as well")
	case <-time.After(300 * time.Millisecond):
	}
}
