package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type AuthHandler struct {
	db  *sqlx.DB
	cfg *config.Config
}

func NewAuthHandler(db *sqlx.DB, cfg *config.Config) *AuthHandler {
	return &AuthHandler{db: db, cfg: cfg}
}

type registerRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type authResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	// Only allow registration if no users exist
	count, err := models.CountUsers(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "database error")
		return
	}
	if count > 0 {
		pagination.WriteError(w, http.StatusForbidden, "registration is disabled after initial setup")
		return
	}

	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.Username) < 3 {
		pagination.WriteError(w, http.StatusBadRequest, "username must be at least 3 characters")
		return
	}
	if err := crypto.ValidatePassword(req.Password); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	hash, err := crypto.HashPassword(req.Password)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	user, err := models.CreateUser(h.db, req.Username, hash, true) // First user is always admin
	if err != nil {
		pagination.WriteError(w, http.StatusConflict, "username already exists")
		return
	}

	h.issueTokens(w, r, user)
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, err := models.GetUserByUsername(h.db, req.Username)
	if err != nil {
		pagination.WriteError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	valid, err := crypto.VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !valid {
		pagination.WriteError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	h.issueTokens(w, r, user)
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("refresh_token")
	if err != nil {
		pagination.WriteError(w, http.StatusUnauthorized, "no refresh token")
		return
	}

	tokenHash := crypto.HashRefreshToken(cookie.Value)
	rt, err := models.GetRefreshTokenByHash(h.db, tokenHash)
	if err != nil {
		pagination.WriteError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	// Delete the used refresh token (rotation)
	_ = models.DeleteRefreshToken(h.db, tokenHash)

	user, err := models.GetUserByID(h.db, rt.UserID)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "user not found")
		return
	}

	h.issueTokens(w, r, user)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("refresh_token")
	if err == nil {
		tokenHash := crypto.HashRefreshToken(cookie.Value)
		_ = models.DeleteRefreshToken(h.db, tokenHash)
	}

	http.SetCookie(w, h.refreshCookie(r, "", -1))
	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) Status(w http.ResponseWriter, r *http.Request) {
	count, err := models.CountUsers(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "database error")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"setup_required": count == 0,
	})
}

func (h *AuthHandler) issueTokens(w http.ResponseWriter, r *http.Request, user *models.User) {
	accessToken, err := crypto.GenerateAccessToken(h.cfg.JWTSecret, user.ID, user.Username, user.IsAdmin)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to generate token")
		return
	}

	refreshToken, err := crypto.GenerateRefreshToken()
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to generate refresh token")
		return
	}

	tokenHash := crypto.HashRefreshToken(refreshToken)
	expiresAt := time.Now().Add(crypto.RefreshTokenExpiry)
	if err := models.CreateRefreshToken(h.db, user.ID, tokenHash, expiresAt); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to store refresh token")
		return
	}

	http.SetCookie(w, h.refreshCookie(r, refreshToken, int(crypto.RefreshTokenExpiry.Seconds())))

	pagination.WriteJSON(w, http.StatusOK, authResponse{
		AccessToken: accessToken,
		TokenType:   "Bearer",
		ExpiresIn:   int(crypto.AccessTokenExpiry.Seconds()),
	})
}

// refreshCookie builds the refresh token cookie with Secure set only over HTTPS.
func (h *AuthHandler) refreshCookie(r *http.Request, value string, maxAge int) *http.Cookie {
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	return &http.Cookie{
		Name:     "refresh_token",
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	}
}
