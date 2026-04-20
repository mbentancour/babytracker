package handlers

import (
	"encoding/json"
	"net/http"
	"regexp"
	"sync"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

var deviceNameRe = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,64}$`)

// subKey namespaces display subscribers by the authenticated user's ID so
// two users can register the same device name ("nursery-tablet") without
// colliding, and so a non-admin can never target another user's device by
// name alone.
type subKey struct {
	userID int
	device string
}

type DisplayHandler struct {
	db     *sqlx.DB
	subsMu sync.Mutex
	subs   map[subKey]chan DisplayCommand
}

// DisplayCommand is the payload sent over the SSE channel. Optional fields
// distinguish the kind of event:
//   - SetPictureFrame=true → drive picture frame state via PictureFrame field
//   - NewPhoto=true → notify clients that a new photo is available
type DisplayCommand struct {
	SetPictureFrame bool   `json:"set_picture_frame,omitempty"`
	PictureFrame    bool   `json:"picture_frame,omitempty"`
	NewPhoto        bool   `json:"new_photo,omitempty"`
	Device          string `json:"device,omitempty"` // empty = all of the caller's devices
}

func NewDisplayHandler(db *sqlx.DB) *DisplayHandler {
	return &DisplayHandler{
		db:   db,
		subs: make(map[subKey]chan DisplayCommand),
	}
}

// BroadcastNewPhoto fans a new-photo notification out to every connected
// display, regardless of which user owns it. Photos that show up in any
// child's gallery may be relevant to any tablet — household-wide broadcast
// is intentional.
func (h *DisplayHandler) BroadcastNewPhoto() {
	cmd := DisplayCommand{NewPhoto: true}
	h.subsMu.Lock()
	defer h.subsMu.Unlock()
	for _, ch := range h.subs {
		select {
		case ch <- cmd:
		default:
		}
	}
}

// SetState fans a display command out to the caller's own devices.
//
// Admin behaviour: admins are deliberately allowed to push to every connected
// device, across every user. This preserves the operator-dashboard use case
// (one admin UI driving displays for the whole household). If the product
// intent changes to "admins can only manage devices they registered", this
// is the place to add a per-device ownership check.
//
// PUT /api/display
// Body: {"picture_frame": true} — targets all of the caller's devices
// Body: {"picture_frame": true, "device": "nursery-tablet"} — one device by name
func (h *DisplayHandler) SetState(w http.ResponseWriter, r *http.Request) {
	var cmd DisplayCommand
	if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// SetState is a picture-frame command; mark it so clients distinguish from
	// other broadcast types (e.g. new-photo notifications).
	cmd.SetPictureFrame = true
	cmd.NewPhoto = false

	userID := middleware.GetUserID(r.Context())
	var isAdmin bool
	h.db.Get(&isAdmin, `SELECT is_admin FROM users WHERE id = $1`, userID)

	h.subsMu.Lock()
	targeted := 0
	for key, ch := range h.subs {
		// Non-admins can only target their own devices. Admins can target
		// any device. The Device filter narrows further within that scope.
		if !isAdmin && key.userID != userID {
			continue
		}
		if cmd.Device != "" && cmd.Device != key.device {
			continue
		}
		select {
		case ch <- cmd:
			targeted++
		default:
		}
	}
	h.subsMu.Unlock()

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"picture_frame":    cmd.PictureFrame,
		"device":           cmd.Device,
		"devices_targeted": targeted,
	})
}

// GetState returns the list of device names the caller owns that currently
// have an SSE connection. Admins see every connected device across every
// user — pair with SetState's admin-broadcast semantics.
func (h *DisplayHandler) GetState(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var isAdmin bool
	h.db.Get(&isAdmin, `SELECT is_admin FROM users WHERE id = $1`, userID)

	h.subsMu.Lock()
	devices := make([]string, 0, len(h.subs))
	for key := range h.subs {
		if isAdmin || key.userID == userID {
			devices = append(devices, key.device)
		}
	}
	h.subsMu.Unlock()

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"connected_devices": devices,
	})
}

// Events is the SSE endpoint. Clients connect with ?device=name to register.
// GET /api/display/events?device=nursery-tablet
func (h *DisplayHandler) Events(w http.ResponseWriter, r *http.Request) {
	// Authenticate via refresh_token cookie (EventSource can't send headers).
	// We need the user_id, not just "is this token valid" — the subscriber
	// map is keyed by user so another user can't evict this device's
	// connection by reusing its name.
	var userID int
	authenticated := false
	if cookie, err := r.Cookie("refresh_token"); err == nil && cookie.Value != "" {
		tokenHash := crypto.HashRefreshToken(cookie.Value)
		if rt, err := models.GetRefreshTokenByHash(h.db, tokenHash); err == nil {
			userID = rt.UserID
			authenticated = true
		}
	}
	if !authenticated {
		http.Error(w, `{"error":"authentication required"}`, http.StatusUnauthorized)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	device := r.URL.Query().Get("device")
	if device == "" {
		device = "default"
	}
	if !deviceNameRe.MatchString(device) {
		device = "default"
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	key := subKey{userID: userID, device: device}
	ch := make(chan DisplayCommand, 16)
	h.subsMu.Lock()
	// Close the previous channel at the same (user, device) key — same user
	// reconnecting with the same device name, e.g. after a laptop wake.
	// Other users with a device named "nursery-tablet" are unaffected because
	// they occupy a different key.
	if old, exists := h.subs[key]; exists {
		close(old)
	}
	h.subs[key] = ch
	h.subsMu.Unlock()

	defer func() {
		h.subsMu.Lock()
		if h.subs[key] == ch {
			delete(h.subs, key)
		}
		h.subsMu.Unlock()
	}()

	// Send a connected event (use json.Marshal for safe encoding)
	connMsg, _ := json.Marshal(map[string]any{"connected": true, "device": device})
	w.Write([]byte("data: "))
	w.Write(connMsg)
	w.Write([]byte("\n\n"))
	flusher.Flush()

	for {
		select {
		case cmd, ok := <-ch:
			if !ok {
				return // Channel closed (replaced by new connection)
			}
			data, _ := json.Marshal(cmd)
			w.Write([]byte("data: "))
			w.Write(data)
			w.Write([]byte("\n\n"))
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
