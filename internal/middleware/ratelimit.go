package middleware

import (
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/mbentancour/babytracker/internal/pagination"
)

// Limiter is a fixed-window counter keyed by an arbitrary string.
//
// Exported because the interesting auth limits can't be keyed by IP. Under
// Home Assistant ingress every request reaches this process from the
// Supervisor's proxy, so RemoteAddr is one value for the entire household and
// an IP-keyed bucket is shared by every user and device — which is how one
// tablet's refresh burst used to log the whole family out.
//
// X-Forwarded-For can't rescue that. HA Core appends the peer it saw and the
// Supervisor appends again on top, so the last entry is Core's container IP (a
// constant) and the entry that actually identifies the browser sits at a
// position that varies with how many proxies are in front of Core — while the
// leftmost entry is whatever the client chose to send. Neither end is both
// trustworthy and identifying.
//
// So the auth handlers key these buckets by credential instead: the username
// being tried, or the session being refreshed. That also happens to be the
// better brute-force control, since it follows the account rather than the
// network path.
type Limiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
	max      int
	window   time.Duration
}

func NewLimiter(max int, window time.Duration) *Limiter {
	rl := &Limiter{
		attempts: make(map[string][]time.Time),
		max:      max,
		window:   window,
	}
	// Periodic cleanup
	go func() {
		for {
			time.Sleep(window)
			rl.mu.Lock()
			now := time.Now()
			for key, times := range rl.attempts {
				valid := times[:0]
				for _, t := range times {
					if now.Sub(t) < window {
						valid = append(valid, t)
					}
				}
				if len(valid) == 0 {
					delete(rl.attempts, key)
				} else {
					rl.attempts[key] = valid
				}
			}
			rl.mu.Unlock()
		}
	}()
	return rl
}

// Allow records an attempt against `key` and reports whether it is within
// the window's budget.
func (rl *Limiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	times := rl.attempts[key]

	// Remove expired entries
	valid := times[:0]
	for _, t := range times {
		if now.Sub(t) < rl.window {
			valid = append(valid, t)
		}
	}

	if len(valid) >= rl.max {
		rl.attempts[key] = valid
		return false
	}

	rl.attempts[key] = append(valid, now)
	return true
}

func RateLimit(maxRequests int, window time.Duration) func(http.Handler) http.Handler {
	rl := NewLimiter(maxRequests, window)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Use RemoteAddr only — X-Forwarded-For is user-controlled and
			// spoofable (see the note on Limiter for why it can't be trusted
			// even under ingress). Strip the source port so successive
			// connections from the same client share a bucket (previously each
			// new TCP connection got a fresh quota).
			//
			// Under HA ingress this key is the Supervisor's proxy for everyone,
			// so an IP-keyed limit is a whole-deployment ceiling rather than a
			// per-client one. Endpoints that need to tell clients apart use a
			// Limiter keyed by credential instead.
			ip, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				ip = r.RemoteAddr
			}

			if !rl.Allow(ip) {
				w.Header().Set("Retry-After", "60")
				pagination.WriteError(w, http.StatusTooManyRequests, "too many requests")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
