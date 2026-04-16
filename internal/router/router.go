package router

import (
	"io/fs"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/handlers"
	"github.com/mbentancour/babytracker/internal/middleware"
)

func New(db *sqlx.DB, cfg *config.Config) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.Ingress) // Strip HA ingress path prefix before routing
	r.Use(middleware.SecurityHeaders)
	r.Use(middleware.Logging)

	// Handlers
	authH := handlers.NewAuthHandler(db, cfg)
	childrenH := handlers.NewChildrenHandler(db)
	feedingsH := handlers.NewFeedingsHandler(db)
	sleepH := handlers.NewSleepHandler(db)
	changesH := handlers.NewChangesHandler(db)
	tummyTimesH := handlers.NewTummyTimesHandler(db)
	timersH := handlers.NewTimersHandler(db)
	temperatureH := handlers.NewTemperatureHandler(db)
	weightH := handlers.NewWeightHandler(db)
	heightH := handlers.NewHeightHandler(db)
	pumpingH := handlers.NewPumpingHandler(db)
	notesH := handlers.NewNotesHandler(db)
	configH := handlers.NewConfigHandler(cfg)
	mediaH := handlers.NewMediaHandler(cfg, db)
	deleteH := handlers.NewGenericDeleteHandler(db, cfg)

	// New feature handlers
	headCircH := handlers.NewHeadCircumferenceHandler(db)
	tagsH := handlers.NewTagsHandler(db)
	medicationsH := handlers.NewMedicationsHandler(db)
	milestonesH := handlers.NewMilestonesHandler(db)
	remindersH := handlers.NewRemindersHandler(db)
	apiTokensH := handlers.NewAPITokensHandler(db)
	webhooksH := handlers.NewWebhooksHandler(db)
	bmiH := handlers.NewBMIHandler(db)
	exportH := handlers.NewExportHandler(db)
	galleryH := handlers.NewGalleryHandler(db, cfg)
	photosH := handlers.NewPhotosHandler(db, cfg)
	usersH := handlers.NewUsersHandler(db)
	backupH := handlers.NewBackupHandler(cfg, db)
	bbImportH := handlers.NewBBImportHandler(db)
	displayH := handlers.NewDisplayHandler(db)
	domainH := handlers.NewDomainHandler(db)
	systemH := handlers.NewSystemHandler()

	// Auth routes (public, rate-limited)
	r.Group(func(r chi.Router) {
		r.Use(middleware.RateLimit(5, time.Minute))
		r.Post("/api/auth/register", authH.Register)
		r.Post("/api/auth/login", authH.Login)
		r.Post("/api/auth/refresh", authH.Refresh)
		r.Post("/api/auth/logout", authH.Logout)
		r.Get("/api/auth/status", authH.Status)
	})

	// Setup-mode restore: pre-auth, only works when no user exists yet.
	// Handler verifies user count internally; here we just give it a rate
	// limiter to deter blind-upload abuse during the brief setup window.
	r.Group(func(r chi.Router) {
		r.Use(middleware.RateLimit(3, time.Minute))
		r.Post("/api/auth/setup-restore", backupH.SetupRestore)
	})

	// Config endpoint (public - needed before login for demo mode detection)
	r.Get("/api/config", configH.Get)

	// Setup endpoints (public during setup mode, blocked otherwise)
	setupH := handlers.NewSetupHandler(cfg)
	r.Get("/api/setup/status", setupH.Status)
	r.Group(func(r chi.Router) {
		r.Use(setupH.RequireSetupMode)
		r.Get("/api/setup/wifi/scan", setupH.WifiScan)
		r.Post("/api/setup/wifi/connect", setupH.WifiConnect)
		r.Post("/api/setup/complete", setupH.Complete)
	})

	// Media serving (authenticated via JWT header OR refresh_token cookie)
	r.Get("/api/media/*", mediaH.ServePhoto)

	// SSE for display state changes (uses cookie auth, EventSource can't send headers)
	r.Get("/api/display/events", displayH.Events)

	// Protected API routes (with 1MB body limit for JSON endpoints)
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(cfg.JWTSecret, db))
		r.Use(middleware.RBAC(db))
		r.Use(middleware.MaxBodySize(1 << 20))

		// Children
		r.Get("/api/children/", childrenH.List)
		r.Post("/api/children/", childrenH.Create)
		r.Patch("/api/children/{id}/", childrenH.Update)
		r.Put("/api/children/{id}/photo", mediaH.SetChildPhotoFromFilename)
		r.Delete("/api/children/{id}/", deleteH.DeleteChild())

		// Feedings
		r.Get("/api/feedings/", feedingsH.List)
		r.Post("/api/feedings/", feedingsH.Create)
		r.Patch("/api/feedings/{id}/", feedingsH.Update)
		r.Delete("/api/feedings/{id}/", deleteH.DeleteFeeding())

		// Sleep
		r.Get("/api/sleep/", sleepH.List)
		r.Post("/api/sleep/", sleepH.Create)
		r.Patch("/api/sleep/{id}/", sleepH.Update)
		r.Delete("/api/sleep/{id}/", deleteH.DeleteSleep())

		// Changes (diapers)
		r.Get("/api/changes/", changesH.List)
		r.Post("/api/changes/", changesH.Create)
		r.Patch("/api/changes/{id}/", changesH.Update)
		r.Delete("/api/changes/{id}/", deleteH.DeleteChange())

		// Tummy times
		r.Get("/api/tummy-times/", tummyTimesH.List)
		r.Post("/api/tummy-times/", tummyTimesH.Create)
		r.Patch("/api/tummy-times/{id}/", tummyTimesH.Update)
		r.Delete("/api/tummy-times/{id}/", deleteH.DeleteTummyTime())

		// Timers
		r.Get("/api/timers/", timersH.List)
		r.Post("/api/timers/", timersH.Create)
		r.Patch("/api/timers/{id}/", timersH.Update)
		r.Delete("/api/timers/{id}/", timersH.Delete)

		// Temperature
		r.Get("/api/temperature/", temperatureH.List)
		r.Post("/api/temperature/", temperatureH.Create)
		r.Patch("/api/temperature/{id}/", temperatureH.Update)
		r.Delete("/api/temperature/{id}/", deleteH.DeleteTemperature())

		// Weight
		r.Get("/api/weight/", weightH.List)
		r.Post("/api/weight/", weightH.Create)
		r.Patch("/api/weight/{id}/", weightH.Update)
		r.Delete("/api/weight/{id}/", deleteH.DeleteWeight())

		// Height
		r.Get("/api/height/", heightH.List)
		r.Post("/api/height/", heightH.Create)
		r.Patch("/api/height/{id}/", heightH.Update)
		r.Delete("/api/height/{id}/", deleteH.DeleteHeight())

		// Pumping
		r.Get("/api/pumping/", pumpingH.List)
		r.Post("/api/pumping/", pumpingH.Create)
		r.Delete("/api/pumping/{id}/", deleteH.DeletePumping())

		// Notes
		r.Get("/api/notes/", notesH.List)
		r.Post("/api/notes/", notesH.Create)
		r.Patch("/api/notes/{id}/", notesH.Update)
		r.Delete("/api/notes/{id}/", deleteH.DeleteNote())

		// Head circumference
		r.Get("/api/head-circumference/", headCircH.List)
		r.Post("/api/head-circumference/", headCircH.Create)
		r.Patch("/api/head-circumference/{id}/", headCircH.Update)
		r.Delete("/api/head-circumference/{id}/", headCircH.Delete)

		// Tags
		r.Get("/api/tags/", tagsH.List)
		r.Post("/api/tags/", tagsH.Create)
		r.Patch("/api/tags/{id}/", tagsH.Update)
		r.Delete("/api/tags/{id}/", tagsH.Delete)
		// `bulk` route is registered BEFORE the {entityType} pattern so chi
		// doesn't route "bulk" as an entity type.
		r.Get("/api/tags/bulk", tagsH.GetEntityTagsBulk)
		r.Get("/api/tags/{entityType}/{entityId}/", tagsH.GetEntityTags)
		r.Put("/api/tags/{entityType}/{entityId}/", tagsH.SetEntityTags)

		// Medications
		r.Get("/api/medications/", medicationsH.List)
		r.Post("/api/medications/", medicationsH.Create)
		r.Patch("/api/medications/{id}/", medicationsH.Update)
		r.Delete("/api/medications/{id}/", medicationsH.Delete)

		// Milestones
		r.Get("/api/milestones/", milestonesH.List)
		r.Post("/api/milestones/", milestonesH.Create)
		r.Patch("/api/milestones/{id}/", milestonesH.Update)
		r.Delete("/api/milestones/{id}/", milestonesH.Delete)

		// BMI
		r.Get("/api/bmi/", bmiH.List)
		r.Post("/api/bmi/", bmiH.Create)
		r.Patch("/api/bmi/{id}/", bmiH.Update)
		r.Delete("/api/bmi/{id}/", bmiH.Delete)

		// Reminders
		r.Get("/api/reminders/", remindersH.List)
		r.Post("/api/reminders/", remindersH.Create)
		r.Patch("/api/reminders/{id}/", remindersH.Update)
		r.Delete("/api/reminders/{id}/", remindersH.Delete)

		// API tokens (for external integrations)
		r.Get("/api/tokens/", apiTokensH.List)
		r.Post("/api/tokens/", apiTokensH.Create)
		r.Delete("/api/tokens/{id}/", apiTokensH.Delete)

		// Webhooks
		r.Get("/api/webhooks/", webhooksH.List)
		r.Post("/api/webhooks/", webhooksH.Create)
		r.Patch("/api/webhooks/{id}/", webhooksH.Update)
		r.Delete("/api/webhooks/{id}/", webhooksH.Delete)

		// Data export
		r.Get("/api/export/csv", exportH.ExportCSV)

		// Standalone photos (GET, PATCH, DELETE are small payloads)
		r.Get("/api/photos/", photosH.List)
		r.Patch("/api/photos/{id}/", photosH.Update)
		r.Delete("/api/photos/{id}/", photosH.Delete)

		// Photo gallery (aggregates all photos)
		r.Get("/api/gallery/", galleryH.List)
		r.Post("/api/gallery/tag", galleryH.TagPhoto)

		// Display control (for Home Assistant / external automation)
		r.Get("/api/display", displayH.GetState)
		r.Put("/api/display", displayH.SetState)

		// Admin-only routes get a defence-in-depth fresh-admin check so a
		// demoted admin can't exercise their access token's remaining TTL
		// against destructive endpoints. Handlers still call requireAdmin for
		// belt-and-braces.
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireFreshAdmin(db))

			// Backups
			r.Get("/api/backups/", backupH.List)
			r.Post("/api/backups/", backupH.Create)
			r.Get("/api/backups/download", backupH.Download)
			r.Delete("/api/backups/", backupH.Delete)

			// Backup destinations
			r.Get("/api/backups/destinations", backupH.ListDestinations)
			r.Post("/api/backups/destinations", backupH.CreateDestination)
			r.Patch("/api/backups/destinations/{id}", backupH.UpdateDestination)
			r.Delete("/api/backups/destinations/{id}", backupH.DeleteDestination)
			r.Post("/api/backups/destinations/{id}/test", backupH.TestDestination)
			r.Post("/api/backups/destinations/inspect-cert", backupH.InspectCert)

			// Baby Buddy import
			r.Post("/api/import/babybuddy", bbImportH.Import)

			// User management (me/password routes are NOT admin-only — handled below)
			r.Get("/api/users/", usersH.List)
			r.Post("/api/users/", usersH.Create)
			r.Delete("/api/users/{id}/", usersH.Delete)
			r.Post("/api/users/{id}/access", usersH.GrantAccess)
			r.Delete("/api/users/{userId}/access/{childId}", usersH.RevokeAccess)
			r.Put("/api/users/{id}/password", usersH.ResetPassword)

			// Roles
			r.Get("/api/roles/", usersH.ListRoles)
			r.Post("/api/roles/", usersH.CreateRole)
			r.Put("/api/roles/{id}/permissions", usersH.UpdateRolePermissions)
			r.Delete("/api/roles/{id}/", usersH.DeleteRole)

			// Domain/TLS settings
			r.Get("/api/settings/domain", domainH.Get)
			r.Put("/api/settings/domain", domainH.Set)
		})

		// Non-admin user-management self-service endpoints
		r.Get("/api/users/me", usersH.GetCurrentUserAccess)
		r.Put("/api/users/me/password", usersH.ChangeOwnPassword)

		r.Delete("/api/{entityType}/{id}/photo", mediaH.DeleteEntryPhoto)

		// System controls (admin only — fresh DB check + handler check)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireFreshAdmin(db))
			r.Post("/api/system/restart", systemH.Restart)
			r.Post("/api/system/shutdown", systemH.Shutdown)
		})
	})

	// Upload routes (auth required, NO body size limit — handlers set their own)
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(cfg.JWTSecret, db))
		r.Use(middleware.RBAC(db))
		r.Post("/api/photos/", photosH.Upload)
		r.Post("/api/children/{id}/photo", mediaH.UploadChildPhoto)
		r.Post("/api/milestones/{id}/photo", mediaH.UploadMilestonePhoto)
		r.Post("/api/{entityType}/{id}/photo", mediaH.UploadEntryPhoto)

		// Restore is the single most destructive endpoint — drop+recreate
		// schema. Re-check admin status from the DB.
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireFreshAdmin(db))
			r.Post("/api/backups/restore", backupH.Restore)
		})
	})

	// SPA serving - serve frontend static files
	spaHandler := newSPAHandler()
	r.Handle("/*", spaHandler)

	return r
}

// spaHandler serves the embedded React SPA.
type spaHandler struct {
	staticFS   http.FileSystem
	fileServer http.Handler
}

func newSPAHandler() *spaHandler {
	staticFS := getStaticFS()
	return &spaHandler{
		staticFS:   staticFS,
		fileServer: http.FileServer(staticFS),
	}
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// Try to serve the file directly
	if f, err := h.staticFS.Open(path); err == nil {
		stat, _ := f.Stat()
		f.Close()
		if stat != nil && !stat.IsDir() {
			r.URL.Path = path
			h.fileServer.ServeHTTP(w, r)
			return
		}
	}

	// SPA fallback: serve index.html for all other routes
	r.URL.Path = "/"
	h.fileServer.ServeHTTP(w, r)
}

func getStaticFS() http.FileSystem {
	if staticFiles != nil {
		subFS, err := fs.Sub(staticFiles, "static")
		if err == nil {
			return http.FS(subFS)
		}
	}
	return http.Dir("frontend/dist")
}
