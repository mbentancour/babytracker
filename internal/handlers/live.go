package handlers

import (
	"net/http"
	"strings"
	"sync"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// liveHeartbeat is how often an idle stream sends a comment line. It keeps
// reverse proxies from closing a quiet connection and lets the server notice
// a client that went away.
const liveHeartbeat = 25 * time.Second

// LiveHandler tells open screens that something changed, so a feed logged on
// one phone shows on the other at once instead of at its next poll.
//
// The message carries no data, only "refetch": what each viewer may see is
// still decided by the normal API when they do. It goes to the screens of the
// people who can see the child that changed; a change that is not about one
// child (a setting, a user, the list of children) goes to everyone. Clients
// keep polling as well, so a missed message or a dropped stream costs at most
// one poll interval.
type LiveHandler struct {
	db *sqlx.DB

	mu     sync.Mutex
	subs   map[chan struct{}]int // each open stream, and the user it belongs to
	closed bool
}

func NewLiveHandler(db *sqlx.DB) *LiveHandler {
	return &LiveHandler{db: db, subs: make(map[chan struct{}]int)}
}

// Notify wakes every connected screen.
func (h *LiveHandler) Notify() {
	h.wake(nil)
}

// wake sends a wake-up to the streams of the given users, or to every stream
// when users is nil. It never blocks: each subscriber has a one-slot buffer,
// and a screen that already has a wake-up pending doesn't need another.
func (h *LiveHandler) wake(users map[int]bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch, userID := range h.subs {
		if users != nil && !users[userID] {
			continue
		}
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (h *LiveHandler) listening() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs) > 0
}

// liveEveryonePrefixes are writes that go to everyone whichever child they
// name. The list of children itself is one: by the time a child has been
// deleted, the rows saying who could see it are gone too. Photos are the
// other: one photo can belong to several children, and a request names at
// most one of them.
var liveEveryonePrefixes = []string{"/api/children/", "/api/photos/", "/api/gallery/"}

// changed wakes the screens a successful write matters to: those of the
// people who can see the children it was about, or everyone's when it named
// no child.
func (h *LiveHandler) changed(path string, children []int) {
	if !h.listening() {
		return
	}
	everyone := len(children) == 0
	for _, prefix := range liveEveryonePrefixes {
		everyone = everyone || strings.HasPrefix(path, prefix)
	}
	if !everyone {
		if ids, err := models.GetChildViewerIDs(h.db, children); err == nil {
			users := make(map[int]bool, len(ids))
			for _, id := range ids {
				users[id] = true
			}
			h.wake(users)
			return
		}
		// Not knowing who may see it is no reason to tell nobody. The
		// message carries no data, so waking everyone is the safe failure.
	}
	h.wake(nil)
}

// CloseAll ends every stream. Used at shutdown so the long-lived handlers
// return instead of holding http.Server.Shutdown to its deadline.
func (h *LiveHandler) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.closed = true
	for ch := range h.subs {
		close(ch)
		delete(h.subs, ch)
	}
}

func (h *LiveHandler) subscribe(userID int) chan struct{} {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	ch := make(chan struct{}, 1)
	h.subs[ch] = userID
	return ch
}

func (h *LiveHandler) unsubscribe(ch chan struct{}) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.subs, ch)
}

// liveQuietPrefixes are writes that change nothing a dashboard shows:
// signing in and refreshing tokens (which every open screen does every few
// minutes), display commands, and first-boot setup.
var liveQuietPrefixes = []string{"/api/auth/", "/api/display", "/api/setup/", "/api/events"}

// Middleware notifies the open screens after any request that changed
// something: a write method that succeeded. Hooking the router instead of
// each handler means a new endpoint is covered without remembering to.
//
// Which screens depends on the children the request turned out to be about,
// which the access checks further in note on the scope put on it here (see
// middleware.ChangeScope).
func (h *LiveHandler) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		default:
			next.ServeHTTP(w, r)
			return
		}
		for _, prefix := range liveQuietPrefixes {
			if strings.HasPrefix(r.URL.Path, prefix) {
				next.ServeHTTP(w, r)
				return
			}
		}
		ctx, scope := middleware.WithChangeScope(r.Context())
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r.WithContext(ctx))
		// Status is 0 when the handler wrote nothing, which net/http sends as 200.
		if status := ww.Status(); status == 0 || (status >= 200 && status < 300) {
			h.changed(r.URL.Path, scope.Children())
		}
	})
}

// Events is the stream itself (server-sent events).
// GET /api/events
func (h *LiveHandler) Events(w http.ResponseWriter, r *http.Request) {
	// Authenticated by the refresh_token cookie, like /api/display/events:
	// EventSource cannot send an Authorization header. The token also says
	// whose screen this is, which decides what it is woken for.
	userID := 0
	if cookie, err := r.Cookie("refresh_token"); err == nil && cookie.Value != "" {
		if token, err := models.GetRefreshTokenByHash(h.db, crypto.HashRefreshToken(cookie.Value)); err == nil {
			userID = token.UserID
		}
	}
	if userID == 0 {
		pagination.WriteError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	ch := h.subscribe(userID)
	if ch == nil {
		http.Error(w, "shutting down", http.StatusServiceUnavailable)
		return
	}
	defer h.unsubscribe(ch)

	// The server's write timeout is sized for ordinary requests; this one is
	// meant to stay open.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	// Nginx-style proxies buffer responses unless told not to.
	w.Header().Set("X-Accel-Buffering", "no")

	send := func(line string) bool {
		if _, err := w.Write([]byte(line)); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	// A first message on every (re)connect: the client refetches on it, to
	// pick up anything that changed while it was not listening.
	if !send("data: {\"connected\":true}\n\n") {
		return
	}

	heartbeat := time.NewTicker(liveHeartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case _, open := <-ch:
			if !open || !send("data: {\"changed\":true}\n\n") {
				return
			}
		case <-heartbeat.C:
			if !send(": keep-alive\n\n") {
				return
			}
		case <-r.Context().Done():
			return
		}
	}
}
