package handlers

import (
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
	"github.com/mbentancour/babytracker/internal/webhooks"
)

type MilkWasteHandler struct {
	db *sqlx.DB
}

func NewMilkWasteHandler(db *sqlx.DB) *MilkWasteHandler {
	return &MilkWasteHandler{db: db}
}

func (h *MilkWasteHandler) List(w http.ResponseWriter, r *http.Request) {
	accessible, ok := accessibleChildren(w, r, h.db)
	if !ok {
		return
	}
	pp := pagination.ParseParams(r, "milk_waste")
	qr := pagination.BuildQuery(r, pagination.FilterConfig{
		Table:              "milk_waste",
		ChildIDField:       "child_id",
		AccessibleChildren: accessible,
		TimeFields: map[string]string{
			"date_min": "time",
			"date_max": "time",
		},
	}, pp)

	resp, err := pagination.Execute[models.MilkWaste](h.db, qr)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to list milk waste")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, resp)
}

func (h *MilkWasteHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input models.MilkWasteInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	t, err := time.Parse("2006-01-02T15:04:05", input.Time)
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid time format")
		return
	}
	// Unlike most amounts in the app this one is required and must be
	// positive: a zero-or-negative discard would silently corrupt the stock
	// balance rather than just leaving a field blank.
	if input.Amount <= 0 {
		pagination.WriteError(w, http.StatusBadRequest, "amount must be greater than zero")
		return
	}

	m := models.MilkWaste{
		ChildID: input.Child,
		Time:    t,
		Amount:  input.Amount,
		Notes:   input.Notes,
	}

	if err := models.CreateMilkWaste(h.db, &m); err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to create milk waste")
		return
	}
	webhooks.Fire("milk_waste.created", m)
	pagination.WriteJSON(w, http.StatusCreated, m)
}

func (h *MilkWasteHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if !ensureWritable(w, r, h.db, "milk_waste", id) {
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	allowed := map[string]string{
		"time":   "time",
		"amount": "amount",
		"notes":  "notes",
	}
	updates := filterAllowed(body, allowed)
	if len(updates) == 0 {
		pagination.WriteError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}
	// Same rule as Create: an edit must not be able to park a non-positive
	// amount in a row that Create would have rejected.
	if v, ok := updates["amount"]; ok {
		amount, isNumber := v.(float64)
		if !isNumber || amount <= 0 {
			pagination.WriteError(w, http.StatusBadRequest, "amount must be greater than zero")
			return
		}
	}

	result, err := models.UpdateMilkWaste(h.db, id, updates)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to update milk waste")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, result)
}

// MilkStockHandler serves the running stash balance. It is read-only and
// derived — there is no stock table, just three sums over pumping, feedings
// and milk_waste.
type MilkStockHandler struct {
	db *sqlx.DB
}

func NewMilkStockHandler(db *sqlx.DB) *MilkStockHandler {
	return &MilkStockHandler{db: db}
}

func (h *MilkStockHandler) Get(w http.ResponseWriter, r *http.Request) {
	childID, err := strconv.Atoi(r.URL.Query().Get("child"))
	if err != nil || childID <= 0 {
		pagination.WriteError(w, http.StatusBadRequest, "child parameter required")
		return
	}

	// The RBAC middleware already checked ?child= against the pumping feature,
	// but this endpoint returns a whole-history aggregate off a single query
	// param, so it re-checks against the caller's own accessible set rather
	// than trusting the middleware to be the only gate. (Admins get every
	// child back from accessibleChildren, so they pass without a special case.)
	accessible, ok := accessibleChildren(w, r, h.db)
	if !ok {
		return
	}
	if !slices.Contains(accessible, childID) {
		pagination.WriteError(w, http.StatusForbidden, "you don't have access to this child's data")
		return
	}

	stock, err := models.GetMilkStock(h.db, childID)
	if err != nil {
		pagination.WriteError(w, http.StatusInternalServerError, "failed to compute milk stock")
		return
	}
	pagination.WriteJSON(w, http.StatusOK, stock)
}
