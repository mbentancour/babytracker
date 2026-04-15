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
			// HA's Supervisor ingress proxy usually strips the prefix before
			// forwarding (so r.URL.Path is already "/", "/api/config", etc.)
			// but always sets this header so add-ons can build absolute URLs.
			// Only rewrite when the prefix really is present in the path —
			// leaving it alone otherwise is the right no-op, not an error.
			// Source trust is already enforced by the inHAIngress gate above:
			// outside HA we never even look at this header.
			if strings.HasPrefix(r.URL.Path, ingressPath) {
				path := strings.TrimPrefix(r.URL.Path, ingressPath)
				if path == "" || path[0] != '/' {
					path = "/" + path
				}
				r.URL.Path = path
				r.RequestURI = path
				if r.URL.RawQuery != "" {
					r.RequestURI = path + "?" + r.URL.RawQuery
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}
