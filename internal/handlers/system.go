package handlers

import (
	"net/http"
	"os/exec"

	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type SystemHandler struct{}

func NewSystemHandler() *SystemHandler {
	return &SystemHandler{}
}

func (h *SystemHandler) Restart(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := r.Context().Value(middleware.IsAdminKey).(bool)
	if !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{"message": "Restarting..."})

	go func() {
		exec.Command("sudo", "systemctl", "reboot").Run()
	}()
}

func (h *SystemHandler) Shutdown(w http.ResponseWriter, r *http.Request) {
	isAdmin, _ := r.Context().Value(middleware.IsAdminKey).(bool)
	if !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	pagination.WriteJSON(w, http.StatusOK, map[string]any{"message": "Shutting down..."})

	go func() {
		exec.Command("sudo", "systemctl", "poweroff").Run()
	}()
}
