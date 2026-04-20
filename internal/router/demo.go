package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/handlers"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// NewDemo builds a minimal router for DEMO_MODE. The frontend swaps every
// data fetch for its own mockData in demo mode, so the backend only has to
// serve:
//   - the static SPA
//   - /api/config (so the frontend learns demo_mode is on)
//   - /api/auth/status (so the login screen is bypassed)
//
// No database, no migrations, no scheduler, no ACME, no credential
// encryption — useful for quick local demos, screenshots, and anyone who
// wants to poke at the UI without standing up Postgres.
func NewDemo(cfg *config.Config) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.Ingress)
	r.Use(middleware.SecurityHeaders)
	r.Use(middleware.Logging)

	configH := handlers.NewConfigHandler(cfg)
	r.Get("/api/config", configH.Get)

	// Canned auth/status — the frontend only uses this to decide whether to
	// show the first-run setup screen. In demo mode there's no real auth
	// surface, so setup_required is always false.
	r.Get("/api/auth/status", func(w http.ResponseWriter, req *http.Request) {
		pagination.WriteJSON(w, http.StatusOK, map[string]any{
			"setup_required": false,
		})
	})

	// Every other /api/* call the frontend might accidentally make returns a
	// tidy 404 rather than surfacing a stack trace. The frontend shouldn't
	// be calling these in demo mode — if it is, that's a bug worth seeing
	// in the network tab.
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		if len(req.URL.Path) >= 5 && req.URL.Path[:5] == "/api/" {
			pagination.WriteError(w, http.StatusNotFound, "not available in demo mode")
			return
		}
		// Fall through to the SPA for non-API paths.
		newSPAHandler().ServeHTTP(w, req)
	})

	return r
}
