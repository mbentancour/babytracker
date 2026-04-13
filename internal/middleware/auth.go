package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/models"
)

type contextKey string

const UserIDKey contextKey = "user_id"
const UsernameKey contextKey = "username"

// Auth middleware that supports both JWT Bearer tokens and API tokens.
// API tokens use "Token <token>" format, JWT uses "Bearer <token>".
func Auth(jwtSecret string, db *sqlx.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":"missing authorization header"}`, http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 {
				http.Error(w, `{"error":"invalid authorization header"}`, http.StatusUnauthorized)
				return
			}

			switch parts[0] {
			case "Bearer":
				// JWT token auth
				claims, err := crypto.ValidateAccessToken(jwtSecret, parts[1])
				if err != nil {
					http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
					return
				}
				ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
				ctx = context.WithValue(ctx, UsernameKey, claims.Username)
				next.ServeHTTP(w, r.WithContext(ctx))

			case "Token":
				// API token auth for external integrations
				tokenHash := crypto.HashRefreshToken(parts[1])
				apiToken, err := models.GetAPITokenByHash(db, tokenHash)
				if err != nil {
					http.Error(w, `{"error":"invalid API token"}`, http.StatusUnauthorized)
					return
				}

				// Check permissions for write operations
				if r.Method != http.MethodGet && apiToken.Permissions == "read" {
					http.Error(w, `{"error":"API token does not have write permission"}`, http.StatusForbidden)
					return
				}

				// Update last used timestamp (fire and forget)
				go models.UpdateAPITokenLastUsed(db, apiToken.ID)

				user, err := models.GetUserByID(db, apiToken.UserID)
				if err != nil {
					http.Error(w, `{"error":"token user not found"}`, http.StatusUnauthorized)
					return
				}

				ctx := context.WithValue(r.Context(), UserIDKey, user.ID)
				ctx = context.WithValue(ctx, UsernameKey, user.Username)
				next.ServeHTTP(w, r.WithContext(ctx))

			default:
				http.Error(w, `{"error":"invalid authorization scheme, use Bearer or Token"}`, http.StatusUnauthorized)
			}
		})
	}
}

func GetUserID(ctx context.Context) int {
	if v, ok := ctx.Value(UserIDKey).(int); ok {
		return v
	}
	return 0
}
