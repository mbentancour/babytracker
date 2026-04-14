package middleware

import (
	"net/http"
	"strings"
)

// Ingress strips the X-Ingress-Path prefix from all request paths.
// This is required for Home Assistant ingress where all requests arrive
// with a prefix like /api/hassio_ingress/<token>/.
func Ingress(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ingressPath := r.Header.Get("X-Ingress-Path"); ingressPath != "" {
			// Strip the ingress prefix from the URL path
			path := strings.TrimPrefix(r.URL.Path, ingressPath)
			if path == "" || path[0] != '/' {
				path = "/" + path
			}
			r.URL.Path = path

			// Also fix RequestURI
			r.RequestURI = path
			if r.URL.RawQuery != "" {
				r.RequestURI = path + "?" + r.URL.RawQuery
			}
		}
		next.ServeHTTP(w, r)
	})
}
