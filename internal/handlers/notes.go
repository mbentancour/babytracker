package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type NotesHandler struct {
	db *sqlx.DB
}

func NewNotesHandler(db *sqlx.DB) *NotesHandler {
	return &NotesHandler{db: db}
}

func (h *NotesHandler) List(w http.ResponseWriter, r *http.Request) {
	pp := pagination.ParseParams(r, "notes")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:        "notes",
		ChildIDField: "child_id",
		TimeFields: map[string]string{
			"date_min": "time",
			"date_max": "time",
		},
	}, pp)

	resp, err := pagination.Execute[models.Note](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list notes")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *NotesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.NoteInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	t, err := time.Parse("2006-01-02T15:04:05", input.Time)
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid time format")
		return
	}

	n := models.Note{
		ChildID: input.Child,
		Time:    t,
		Note:    input.Note,
	}

	if err := models.CreateNote(h.db, &n); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create note")
		return
	}
	pagination.WriteJSON(w, http.StatusCreated, n)
}

func (h *NotesHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowed := map[string]string{
		"time": "time",
		"note":  "note",
		"photo": "photo",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateNote(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update note")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}
