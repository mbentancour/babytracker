package middleware

import (
	"net/http"
	"os"
)

// noServerHeader wraps a ResponseWriter to suppress the default Server header.
type noServerHeader struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *noServerHeader) WriteHeader(code int) {
	if !w.wroteHeader {
		w.Header().Del("Server")
		w.wroteHeader = true
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *noServerHeader) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.Header().Del("Server")
		w.wroteHeader = true
	}
	return w.ResponseWriter.Write(b)
}

func (w *noServerHeader) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Detect HA add-on mode at startup (not per-request) so CSP can be set correctly.
// HA sets SUPERVISOR_TOKEN or runs with bashio, and our run.sh always sets DATA_DIR=/data/babytracker.
var isHAMode = os.Getenv("SUPERVISOR_TOKEN") != "" || os.Getenv("HASSIO_TOKEN") != ""

// Strict CSP for standalone/direct access.
const strictCSP = "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; form-action 'self'; base-uri 'self'; frame-ancestors 'none'"

// Relaxed CSP for HA ingress — no frame-ancestors (iframe), connect-src * (cross-origin proxy),
// unsafe-inline in script-src (needed through proxy).
const haCSP = "default-src 'self'; script-src 'self' blob: 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src *; worker-src 'self' blob:; form-action 'self'; base-uri 'self'"

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wrapped := &noServerHeader{ResponseWriter: w}

		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")

		if isHAMode {
			w.Header().Set("Content-Security-Policy", haCSP)
		} else {
			w.Header().Set("X-Frame-Options", "DENY")
			w.Header().Set("Content-Security-Policy", strictCSP)
		}

		next.ServeHTTP(wrapped, r)
	})
}
