package handlers

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// csvSafe prevents CSV injection by prefixing formula-starting characters.
func csvSafe(s string) string {
	if len(s) > 0 {
		switch s[0] {
		case '=', '+', '-', '@', '\t', '\r', '\n':
			return "'" + s
		}
	}
	return s
}

type ExportHandler struct {
	db *sqlx.DB
}

func NewExportHandler(db *sqlx.DB) *ExportHandler {
	return &ExportHandler{db: db}
}

func (h *ExportHandler) ExportCSV(w http.ResponseWriter, r *http.Request) {
	childIDStr := r.URL.Query().Get("child")
	if childIDStr == "" {
		pagination.WriteError(w, http.StatusBadRequest, "child parameter is required")
		return
	}
	childID, err := strconv.Atoi(childIDStr)
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid child id")
		return
	}

	entityType := r.URL.Query().Get("type")
	if entityType == "" {
		entityType = "all"
	}

	// Verify the user has access to this child
	userID := middleware.GetUserID(r.Context())
	accessLevel := models.CheckAccess(h.db, userID, childID, "note") // export needs at least read
	if accessLevel == "none" {
		pagination.WriteError(w, http.StatusForbidden, "access denied")
		return
	}

	child, err := models.GetChild(h.db, childID)
	if err != nil {
		pagination.WriteError(w, http.StatusNotFound, "child not found")
		return
	}

	filename := fmt.Sprintf("babytracker_%s_%s.csv", child.FirstName, time.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))

	writer := csv.NewWriter(w)
	defer writer.Flush()

	switch entityType {
	case "feedings":
		h.exportFeedings(writer, childID)
	case "sleep":
		h.exportSleep(writer, childID)
	case "changes":
		h.exportChanges(writer, childID)
	case "tummy_times":
		h.exportTummyTimes(writer, childID)
	case "temperature":
		h.exportTemperature(writer, childID)
	case "weight":
		h.exportWeight(writer, childID)
	case "height":
		h.exportHeight(writer, childID)
	case "head_circumference":
		h.exportHeadCircumference(writer, childID)
	case "medications":
		h.exportMedications(writer, childID)
	case "milestones":
		h.exportMilestones(writer, childID)
	case "all":
		h.exportAll(writer, childID)
	default:
		pagination.WriteError(w, http.StatusBadRequest, "unknown export type")
	}
}

func (h *ExportHandler) exportFeedings(w *csv.Writer, childID int) {
	w.Write([]string{"Type", "Start", "End", "Method", "Amount", "Duration", "Notes"})
	var rows []models.Feeding
	h.db.Select(&rows, `SELECT * FROM feedings WHERE child_id = $1 ORDER BY start_time DESC`, childID)
	for _, r := range rows {
		amount := ""
		if r.Amount != nil {
			amount = fmt.Sprintf("%.1f", *r.Amount)
		}
		dur := ""
		if r.Duration != nil {
			dur = *r.Duration
		}
		w.Write([]string{r.Type, r.Start.Format(time.RFC3339), r.End.Format(time.RFC3339), r.Method, amount, dur, csvSafe(r.Notes)})
	}
}

func (h *ExportHandler) exportSleep(w *csv.Writer, childID int) {
	w.Write([]string{"Start", "End", "Duration", "Nap", "Notes"})
	var rows []models.Sleep
	h.db.Select(&rows, `SELECT * FROM sleep WHERE child_id = $1 ORDER BY start_time DESC`, childID)
	for _, r := range rows {
		dur := ""
		if r.Duration != nil {
			dur = *r.Duration
		}
		w.Write([]string{r.Start.Format(time.RFC3339), r.End.Format(time.RFC3339), dur, fmt.Sprintf("%t", r.Nap), csvSafe(r.Notes)})
	}
}

func (h *ExportHandler) exportChanges(w *csv.Writer, childID int) {
	w.Write([]string{"Time", "Wet", "Solid", "Color", "Notes"})
	var rows []models.Change
	h.db.Select(&rows, `SELECT * FROM changes WHERE child_id = $1 ORDER BY time DESC`, childID)
	for _, r := range rows {
		w.Write([]string{r.Time.Format(time.RFC3339), fmt.Sprintf("%t", r.Wet), fmt.Sprintf("%t", r.Solid), r.Color, csvSafe(r.Notes)})
	}
}

func (h *ExportHandler) exportTummyTimes(w *csv.Writer, childID int) {
	w.Write([]string{"Start", "End", "Duration", "Milestone", "Notes"})
	var rows []models.TummyTime
	h.db.Select(&rows, `SELECT * FROM tummy_times WHERE child_id = $1 ORDER BY start_time DESC`, childID)
	for _, r := range rows {
		dur := ""
		if r.Duration != nil {
			dur = *r.Duration
		}
		w.Write([]string{r.Start.Format(time.RFC3339), r.End.Format(time.RFC3339), dur, csvSafe(r.Milestone),csvSafe(r.Notes)})
	}
}

func (h *ExportHandler) exportTemperature(w *csv.Writer, childID int) {
	w.Write([]string{"Time", "Temperature", "Notes"})
	var rows []models.Temperature
	h.db.Select(&rows, `SELECT * FROM temperature WHERE child_id = $1 ORDER BY time DESC`, childID)
	for _, r := range rows {
		w.Write([]string{r.Time.Format(time.RFC3339), fmt.Sprintf("%.1f", r.Temperature), csvSafe(r.Notes)})
	}
}

func (h *ExportHandler) exportWeight(w *csv.Writer, childID int) {
	w.Write([]string{"Date", "Weight", "Notes"})
	var rows []models.Weight
	h.db.Select(&rows, `SELECT * FROM weight WHERE child_id = $1 ORDER BY date DESC`, childID)
	for _, r := range rows {
		w.Write([]string{r.Date, fmt.Sprintf("%.2f", r.Weight), csvSafe(r.Notes)})
	}
}

func (h *ExportHandler) exportHeight(w *csv.Writer, childID int) {
	w.Write([]string{"Date", "Height", "Notes"})
	var rows []models.Height
	h.db.Select(&rows, `SELECT * FROM height WHERE child_id = $1 ORDER BY date DESC`, childID)
	for _, r := range rows {
		w.Write([]string{r.Date, fmt.Sprintf("%.1f", r.Height), csvSafe(r.Notes)})
	}
}

func (h *ExportHandler) exportHeadCircumference(w *csv.Writer, childID int) {
	w.Write([]string{"Date", "Head Circumference", "Notes"})
	var rows []models.HeadCircumference
	h.db.Select(&rows, `SELECT * FROM head_circumference WHERE child_id = $1 ORDER BY date DESC`, childID)
	for _, r := range rows {
		w.Write([]string{r.Date, fmt.Sprintf("%.1f", r.HeadCircumference), csvSafe(r.Notes)})
	}
}

func (h *ExportHandler) exportMedications(w *csv.Writer, childID int) {
	w.Write([]string{"Time", "Name", "Dosage", "Unit", "Notes"})
	var rows []models.Medication
	h.db.Select(&rows, `SELECT * FROM medications WHERE child_id = $1 ORDER BY time DESC`, childID)
	for _, r := range rows {
		w.Write([]string{r.Time.Format(time.RFC3339), csvSafe(r.Name), csvSafe(r.Dosage), r.DosageUnit, csvSafe(r.Notes)})
	}
}

func (h *ExportHandler) exportMilestones(w *csv.Writer, childID int) {
	w.Write([]string{"Date", "Title", "Category", "Description"})
	var rows []models.Milestone
	h.db.Select(&rows, `SELECT * FROM milestones WHERE child_id = $1 ORDER BY date DESC`, childID)
	for _, r := range rows {
		w.Write([]string{r.Date, csvSafe(r.Title), r.Category, csvSafe(r.Description)})
	}
}

func (h *ExportHandler) exportAll(w *csv.Writer, childID int) {
	w.Write([]string{"--- FEEDINGS ---"})
	h.exportFeedings(w, childID)
	w.Write([]string{""})
	w.Write([]string{"--- SLEEP ---"})
	h.exportSleep(w, childID)
	w.Write([]string{""})
	w.Write([]string{"--- DIAPER CHANGES ---"})
	h.exportChanges(w, childID)
	w.Write([]string{""})
	w.Write([]string{"--- TUMMY TIME ---"})
	h.exportTummyTimes(w, childID)
	w.Write([]string{""})
	w.Write([]string{"--- TEMPERATURE ---"})
	h.exportTemperature(w, childID)
	w.Write([]string{""})
	w.Write([]string{"--- WEIGHT ---"})
	h.exportWeight(w, childID)
	w.Write([]string{""})
	w.Write([]string{"--- HEIGHT ---"})
	h.exportHeight(w, childID)
	w.Write([]string{""})
	w.Write([]string{"--- HEAD CIRCUMFERENCE ---"})
	h.exportHeadCircumference(w, childID)
	w.Write([]string{""})
	w.Write([]string{"--- MEDICATIONS ---"})
	h.exportMedications(w, childID)
	w.Write([]string{""})
	w.Write([]string{"--- MILESTONES ---"})
	h.exportMilestones(w, childID)
}
