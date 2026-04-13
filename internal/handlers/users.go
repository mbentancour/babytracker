package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/crypto"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type UsersHandler struct {
	db *sqlx.DB
}

func NewUsersHandler(db *sqlx.DB) *UsersHandler {
	return &UsersHandler{db: db}
}

func (h *UsersHandler) requireAdmin(r *http.Request) bool {
	userID := middleware.GetUserID(r.Context())
	var isAdmin bool
	h.db.Get(&isAdmin, `SELECT is_admin FROM users WHERE id = $1`, userID)
	return isAdmin
}

// List all users (admin only)
func (h *UsersHandler) List(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}
	users, err := models.ListUsers(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list users")
		return
	}

	// Enrich with access info
	type userWithAccess struct {
		models.User
		Access []models.UserAccess `json:"access"`
	}
	var result []userWithAccess
	for _, u := range users {
		access, _ := models.GetUserChildAccess(h.db, u.ID)
		result = append(result, userWithAccess{User: u, Access: access})
	}

	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(result),
		Results: result,
	})
}

type createUserRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	IsAdmin  bool   `json:"is_admin"`
}

// Create a new user (admin only)
func (h *UsersHandler) Create(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req createUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.Username) < 3 {
		pagination.WriteError(w, http.StatusBadRequest, "username must be at least 3 characters")
		return
	}
	if len(req.Password) < 8 {
		pagination.WriteError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash, err := crypto.HashPassword(req.Password)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to hash password")
		return
	}

	user, err := models.CreateUser(h.db, req.Username, hash, req.IsAdmin)
	if err != nil {
		pagination.WriteError(w, http.StatusConflict, "username already exists")
		return
	}

	pagination.WriteJSON(w, http.StatusCreated, user)
}

// Delete a user (admin only)
func (h *UsersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}

	// Don't allow deleting yourself
	if id == middleware.GetUserID(r.Context()) {
		pagination.WriteError(w, http.StatusBadRequest, "cannot delete your own account")
		return
	}

	if err := models.DeleteUser(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type grantAccessRequest struct {
	ChildID int `json:"child_id"`
	RoleID  int `json:"role_id"`
}

// Grant a user access to a child with a specific role (admin only)
func (h *UsersHandler) GrantAccess(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	userID, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	var req grantAccessRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := models.GrantChildAccess(h.db, userID, req.ChildID, req.RoleID); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to grant access")
		return
	}

	access, _ := models.GetUserChildAccess(h.db, userID)
	pagination.WriteJSON(w, http.StatusOK, access)
}

// Revoke a user's access to a child (admin only)
func (h *UsersHandler) RevokeAccess(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	userID, err := strconv.Atoi(chi.URLParam(r, "userId"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	childID, err := strconv.Atoi(chi.URLParam(r, "childId"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid child id")
		return
	}

	if err := models.RevokeChildAccess(h.db, userID, childID); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to revoke access")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// List roles
func (h *UsersHandler) ListRoles(w http.ResponseWriter, r *http.Request) {
	roles, err := models.ListRoles(h.db)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list roles")
		return
	}

	var result []models.RoleWithPermissions
	for _, role := range roles {
		perms, _ := models.GetRolePermissions(h.db, role.ID)
		result = append(result, models.RoleWithPermissions{Role: role, Permissions: perms})
	}

	pagination.WriteJSON(w, http.StatusOK, pagination.Response{
		Count:   len(result),
		Results: result,
	})
}

type createRoleRequest struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Permissions map[string]string `json:"permissions"`
}

// Create a custom role (admin only)
func (h *UsersHandler) CreateRole(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req createRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		pagination.WriteError(w, http.StatusBadRequest, "name is required")
		return
	}

	role, err := models.CreateRole(h.db, req.Name, req.Description)
	if err != nil {
		pagination.WriteError(w, http.StatusConflict, "role name already exists")
		return
	}

	if len(req.Permissions) > 0 {
		models.SetRolePermissions(h.db, role.ID, req.Permissions)
	}

	perms, _ := models.GetRolePermissions(h.db, role.ID)
	pagination.WriteJSON(w, http.StatusCreated, models.RoleWithPermissions{
		Role:        *role,
		Permissions: perms,
	})
}

type updateRolePermissionsRequest struct {
	Permissions map[string]string `json:"permissions"`
}

// Update role permissions (admin only, custom roles only)
func (h *UsersHandler) UpdateRolePermissions(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	roleID, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid role id")
		return
	}

	var req updateRolePermissionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := models.SetRolePermissions(h.db, roleID, req.Permissions); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update permissions")
		return
	}

	role, _ := models.GetRole(h.db, roleID)
	perms, _ := models.GetRolePermissions(h.db, roleID)
	pagination.WriteJSON(w, http.StatusOK, models.RoleWithPermissions{
		Role:        *role,
		Permissions: perms,
	})
}

// Delete a custom role (admin only)
func (h *UsersHandler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(r) {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := models.DeleteRole(h.db, id); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to delete role")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetCurrentUserAccess returns the current user's access info
func (h *UsersHandler) GetCurrentUserAccess(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	var user models.User
	if err := h.db.Get(&user, `SELECT * FROM users WHERE id = $1`, userID); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to get user")
		return
	}

	access, _ := models.GetUserChildAccess(h.db, userID)

	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"user":     user,
		"is_admin": user.IsAdmin,
		"access":   access,
	})
}
