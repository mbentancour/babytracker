package middleware

import "net/http"

// noServerHeader wraps a ResponseWriter to suppress the default Server header.
// HA's ingress proxy breaks when it encounters certain response headers.
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

// Flush passes through to the underlying ResponseWriter (needed for SSE).
func (w *noServerHeader) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Always suppress the Server header (breaks HA ingress)
		wrapped := &noServerHeader{ResponseWriter: w}

		// When behind HA ingress, skip all security headers.
		// HA's own proxy handles security, and strict headers break
		// iframe embedding and cross-origin API calls.
		if r.Header.Get("X-Ingress-Path") != "" {
			next.ServeHTTP(wrapped, r)
			return
		}

		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
		// Note: 'unsafe-inline' in style-src is required because React uses inline styles.
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; form-action 'self'; base-uri 'self'; frame-ancestors 'none'")

		next.ServeHTTP(wrapped, r)
	})
}
