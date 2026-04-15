package middleware

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type rateLimiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
	max      int
	window   time.Duration
}

func newRateLimiter(max int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{
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
			for ip, times := range rl.attempts {
				valid := times[:0]
				for _, t := range times {
					if now.Sub(t) < window {
						valid = append(valid, t)
					}
				}
				if len(valid) == 0 {
					delete(rl.attempts, ip)
				} else {
					rl.attempts[ip] = valid
				}
			}
			rl.mu.Unlock()
		}
	}()
	return rl
}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	times := rl.attempts[ip]

	// Remove expired entries
	valid := times[:0]
	for _, t := range times {
		if now.Sub(t) < rl.window {
			valid = append(valid, t)
		}
	}

	if len(valid) >= rl.max {
		rl.attempts[ip] = valid
		return false
	}

	rl.attempts[ip] = append(valid, now)
	return true
}

func RateLimit(maxRequests int, window time.Duration) func(http.Handler) http.Handler {
	rl := newRateLimiter(maxRequests, window)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Use RemoteAddr only — X-Forwarded-For is user-controlled and spoofable.
			// If behind a trusted reverse proxy, configure it to set RemoteAddr.
			// Strip the source port so successive connections from the same
			// client share a rate-limit bucket (previously each new TCP
			// connection got a fresh quota).
			ip, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				ip = r.RemoteAddr
			}

			if !rl.allow(ip) {
				w.Header().Set("Retry-After", "60")
				http.Error(w, `{"error":"too many requests"}`, http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
