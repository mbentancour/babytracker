package handlers

import (
	"encoding/json"
	"net/http"
	"regexp"
	"sync"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

var deviceNameRe = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,64}$`)

type DisplayHandler struct {
	db     *sqlx.DB
	subsMu sync.Mutex
	subs   map[string]chan DisplayCommand // keyed by device name
}

type DisplayCommand struct {
	PictureFrame bool   `json:"picture_frame"`
	Device       string `json:"device,omitempty"` // empty = all devices
}

func NewDisplayHandler(db *sqlx.DB) *DisplayHandler {
	return &DisplayHandler{
		db:   db,
		subs: make(map[string]chan DisplayCommand),
	}
}

// SetState sends a display command to a specific device or all devices.
// PUT /api/display
// Body: {"picture_frame": true} — targets all devices
// Body: {"picture_frame": true, "device": "nursery-tablet"} — targets one device
func (h *DisplayHandler) SetState(w http.ResponseWriter, r *http.Request) {
	var cmd DisplayCommand
	if err := json.NewDecoder(r.Body).Decode(&cmd); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	h.subsMu.Lock()
	targeted := 0
	for device, ch := range h.subs {
		if cmd.Device == "" || cmd.Device == device {
			select {
			case ch <- cmd:
				targeted++
			default:
			}
		}
	}
	h.subsMu.Unlock()

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"picture_frame":    cmd.PictureFrame,
		"device":           cmd.Device,
		"devices_targeted": targeted,
	})
}

// GetState returns the list of connected devices.
// GET /api/display
func (h *DisplayHandler) GetState(w http.ResponseWriter, r *http.Request) {
	h.subsMu.Lock()
	devices := make([]string, 0, len(h.subs))
	for name := range h.subs {
		devices = append(devices, name)
	}
	h.subsMu.Unlock()

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"connected_devices": devices,
	})
}

// Events is the SSE endpoint. Clients connect with ?device=name to register.
// GET /api/display/events?device=nursery-tablet
func (h *DisplayHandler) Events(w http.ResponseWriter, r *http.Request) {
	// Authenticate via refresh_token cookie (EventSource can't send headers)
	authenticated := false
	if cookie, err := r.Cookie("refresh_token"); err == nil && cookie.Value != "" {
		tokenHash := crypto.HashRefreshToken(cookie.Value)
		if _, err := models.GetRefreshTokenByHash(h.db, tokenHash); err == nil {
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

	ch := make(chan DisplayCommand, 1)
	h.subsMu.Lock()
	// Close existing connection for the same device name
	if old, exists := h.subs[device]; exists {
		close(old)
	}
	h.subs[device] = ch
	h.subsMu.Unlock()

	defer func() {
		h.subsMu.Lock()
		if h.subs[device] == ch {
			delete(h.subs, device)
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
