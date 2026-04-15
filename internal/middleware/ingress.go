package middleware

import (
	"net/http"
	"os"
	"strings"
)

// inHAIngress is true when the process is running inside a Home Assistant
// add-on (Supervisor sets SUPERVISOR_TOKEN; older versions set HASSIO_TOKEN).
// We only trust the X-Ingress-Path header in that case — on a direct-exposed
// deployment the header is attacker-controlled and cannot be used to rewrite
// the request path without opening a routing-confusion vector.
var inHAIngress = os.Getenv("SUPERVISOR_TOKEN") != "" || os.Getenv("HASSIO_TOKEN") != ""

// Ingress strips the X-Ingress-Path prefix from all request paths when running
// under HA ingress (where all requests arrive with a prefix like
// /api/hassio_ingress/<token>/). Outside HA the header is ignored entirely.
func Ingress(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !inHAIngress {
			next.ServeHTTP(w, r)
			return
		}
		if ingressPath := r.Header.Get("X-Ingress-Path"); ingressPath != "" {
			// Only strip if the header is a genuine prefix. Anything else is
			// either a misconfiguration or an attempt to confuse routing.
			if !strings.HasPrefix(r.URL.Path, ingressPath) {
				http.Error(w, `{"error":"bad ingress prefix"}`, http.StatusBadRequest)
				return
			}
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
