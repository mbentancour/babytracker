package middleware

import "net/http"

func SecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")

		// Note: 'unsafe-inline' in style-src is required because React uses inline styles.
		// No frame-ancestors or X-Frame-Options — HA ingress embeds the app in an iframe
		// and the X-Ingress-Path header is not reliably present on all requests.
		// connect-src * is needed because HA ingress proxies from a different origin.
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' blob: 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src *; worker-src 'self' blob:; form-action 'self'; base-uri 'self'")

		next.ServeHTTP(w, r)
	})
}
