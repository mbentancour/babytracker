package handlers

import (
	"encoding/json"
	"net/http"
	"sync"

	"github.com/mbentancour/babytracker/internal/pagination"
)

// DisplayHandler manages the picture frame state via API.
// This allows external tools (Home Assistant, etc.) to control the display mode.
type DisplayHandler struct {
	mu    sync.RWMutex
	state DisplayState

	// Subscribers waiting for state changes (Server-Sent Events)
	subs   map[chan DisplayState]struct{}
	subsMu sync.Mutex
}

type DisplayState struct {
	PictureFrame bool `json:"picture_frame"`
}

func NewDisplayHandler() *DisplayHandler {
	return &DisplayHandler{
		subs: make(map[chan DisplayState]struct{}),
	}
}

func (h *DisplayHandler) GetState(w http.ResponseWriter, r *http.Request) {
	h.mu.RLock()
	state := h.state
	h.mu.RUnlock()
	pagination.WriteJSON(w, http.StatusOK, state)
}

func (h *DisplayHandler) SetState(w http.ResponseWriter, r *http.Request) {
	var req DisplayState
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	h.mu.Lock()
	h.state = req
	h.mu.Unlock()

	// Notify all SSE subscribers
	h.subsMu.Lock()
	for ch := range h.subs {
		select {
		case ch <- req:
		default:
		}
	}
	h.subsMu.Unlock()

	pagination.WriteJSON(w, http.StatusOK, req)
}

// SSE endpoint: the frontend listens here for real-time display state changes.
func (h *DisplayHandler) Events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := make(chan DisplayState, 1)
	h.subsMu.Lock()
	h.subs[ch] = struct{}{}
	h.subsMu.Unlock()

	defer func() {
		h.subsMu.Lock()
		delete(h.subs, ch)
		h.subsMu.Unlock()
	}()

	// Send current state immediately
	h.mu.RLock()
	current := h.state
	h.mu.RUnlock()

	data, _ := json.Marshal(current)
	w.Write([]byte("data: "))
	w.Write(data)
	w.Write([]byte("\n\n"))
	flusher.Flush()

	// Stream updates
	for {
		select {
		case state := <-ch:
			data, _ := json.Marshal(state)
			w.Write([]byte("data: "))
			w.Write(data)
			w.Write([]byte("\n\n"))
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}
