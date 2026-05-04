package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
	"github.com/mbentancour/babytracker/internal/webhooks"
)

type FeedingsHandler struct {
	db *sqlx.DB
}

func NewFeedingsHandler(db *sqlx.DB) *FeedingsHandler {
	return &FeedingsHandler{db: db}
}

func (h *FeedingsHandler) List(w http.ResponseWriter, r *http.Request) {
	accessible, ok := accessibleChildren(w, r, h.db)
	if !ok {
		return
	}
	pp := pagination.ParseParams(r, "feedings")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:              "feedings",
		ChildIDField:       "child_id",
		AccessibleChildren: accessible,
		TimeFields: map[string]string{
			"start_min": "start_time",
			"start_max": "start_time",
		},
	}, pp)

	resp, err := pagination.Execute[models.Feeding](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list feedings")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *FeedingsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.FeedingInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	f := models.Feeding{
		ChildID: input.Child,
		Type:    input.Type,
		Method:  input.Method,
		Amount:  input.Amount,
		Notes:   input.Notes,
	}

	start, end, timerID, ok := resolveEntryTimes(w, h.db, input.Timer, input.Start, input.End)
	if !ok {
		return
	}
	f.Start = start
	f.End = end
	f.TimerID = timerID

	if f.Type == "" {
		f.Type = "breast milk"
	}
	if f.Method == "" {
		f.Method = "bottle"
	}

	if err := models.CreateFeeding(h.db, &f); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create feeding")
		return
	}
	webhooks.Fire("feeding.created", f)
	pagination.WriteJSON(w, http.StatusCreated, f)
}

func (h *FeedingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !ensureWritable(w, r, h.db, "feedings", id) {
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowed := map[string]string{
		"start":  "start_time",
		"end":    "end_time",
		"type":   "type",
		"method": "method",
		"amount": "amount",
		"notes":  "notes",
		"photo":  "photo",
	}
	updates := filterAllowed(body, allowed)

	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	result, err := models.UpdateFeeding(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update feeding")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}
