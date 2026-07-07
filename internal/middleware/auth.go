package middleware

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type contextKey string

const UserIDKey contextKey = "user_id"
const UsernameKey contextKey = "username"
const IsAdminKey contextKey = "is_admin"

// Auth middleware that supports both JWT Bearer tokens and API tokens.
// API tokens use "Token <token>" format, JWT uses "Bearer <token>".
func Auth(jwtSecret string, db *sqlx.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				pagination.WriteError(w, http.StatusUnauthorized, "missing authorization header")
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 {
				pagination.WriteError(w, http.StatusUnauthorized, "invalid authorization header")
				return
			}

			switch parts[0] {
			case "Bearer":
				// JWT token auth
				claims, err := crypto.ValidateAccessToken(jwtSecret, parts[1])
				if err != nil {
					pagination.WriteError(w, http.StatusUnauthorized, "invalid or expired token")
					return
				}
				ctx := context.WithValue(r.Context(), UserIDKey, claims.UserID)
				ctx = context.WithValue(ctx, UsernameKey, claims.Username)
				ctx = context.WithValue(ctx, IsAdminKey, claims.IsAdmin)
				next.ServeHTTP(w, r.WithContext(ctx))

			case "Token":
				// API token auth for external integrations
				tokenHash := crypto.HashRefreshToken(parts[1])
				apiToken, err := models.GetAPITokenByHash(db, tokenHash)
				if err != nil {
					pagination.WriteError(w, http.StatusUnauthorized, "invalid API token")
					return
				}
				// Defence-in-depth expiry check — GetAPITokenByHash already
				// filters expired rows, but re-checking here keeps the contract
				// explicit if that query ever changes.
				if apiToken.ExpiresAt != nil && time.Now().After(*apiToken.ExpiresAt) {
					pagination.WriteError(w, http.StatusUnauthorized, "API token expired")
					return
				}

				// Check permissions for write operations
				if r.Method != http.MethodGet && apiToken.Permissions == "read" {
					pagination.WriteError(w, http.StatusForbidden, "API token does not have write permission")
					return
				}

				// Update last used timestamp (fire and forget)
				go models.UpdateAPITokenLastUsed(db, apiToken.ID)

				user, err := models.GetUserByID(db, apiToken.UserID)
				if err != nil {
					pagination.WriteError(w, http.StatusUnauthorized, "token user not found")
					return
				}

				ctx := context.WithValue(r.Context(), UserIDKey, user.ID)
				ctx = context.WithValue(ctx, UsernameKey, user.Username)
				ctx = context.WithValue(ctx, IsAdminKey, user.IsAdmin)
				next.ServeHTTP(w, r.WithContext(ctx))

			default:
				pagination.WriteError(w, http.StatusUnauthorized, "invalid authorization scheme, use Bearer or Token")
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
