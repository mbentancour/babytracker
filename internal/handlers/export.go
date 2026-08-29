package handlers

import (
	"encoding/csv"
	"fmt"
	"log/slog"
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
		if err := h.exportFeedings(writer, childID); err != nil {
			slog.Error("export feedings failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "sleep":
		if err := h.exportSleep(writer, childID); err != nil {
			slog.Error("export sleep failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "changes":
		if err := h.exportChanges(writer, childID); err != nil {
			slog.Error("export changes failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "tummy_times":
		if err := h.exportTummyTimes(writer, childID); err != nil {
			slog.Error("export tummy times failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "temperature":
		if err := h.exportTemperature(writer, childID); err != nil {
			slog.Error("export temperature failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "weight":
		if err := h.exportWeight(writer, childID); err != nil {
			slog.Error("export weight failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "height":
		if err := h.exportHeight(writer, childID); err != nil {
			slog.Error("export height failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "head_circumference":
		if err := h.exportHeadCircumference(writer, childID); err != nil {
			slog.Error("export head circumference failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "pumping":
		if err := h.exportPumping(writer, childID); err != nil {
			slog.Error("export pumping failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "milk_waste":
		if err := h.exportMilkWaste(writer, childID); err != nil {
			slog.Error("export milk waste failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "medications":
		if err := h.exportMedications(writer, childID); err != nil {
			slog.Error("export medications failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "milestones":
		if err := h.exportMilestones(writer, childID); err != nil {
			slog.Error("export milestones failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	case "all":
		if err := h.exportAll(writer, childID); err != nil {
			slog.Error("export all failed", "error", err)
			pagination.WriteError(w, http.StatusInternalServerError, "export failed")
			return
		}
	default:
		pagination.WriteError(w, http.StatusBadRequest, "unknown export type")
	}
}

func (h *ExportHandler) exportFeedings(w *csv.Writer, childID int) error {
	w.Write([]string{"Type", "Start", "End", "Method", "Amount", "Duration", "Notes"})
	var rows []models.Feeding
	if err := h.db.Select(&rows, `SELECT * FROM feedings WHERE child_id = $1 ORDER BY start_time DESC`, childID); err != nil {
		return fmt.Errorf("query feedings: %w", err)
	}
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
	return nil
}

func (h *ExportHandler) exportSleep(w *csv.Writer, childID int) error {
	w.Write([]string{"Start", "End", "Duration", "Nap", "Notes"})
	var rows []models.Sleep
	if err := h.db.Select(&rows, `SELECT * FROM sleep WHERE child_id = $1 ORDER BY start_time DESC`, childID); err != nil {
		return fmt.Errorf("query sleep: %w", err)
	}
	for _, r := range rows {
		dur := ""
		if r.Duration != nil {
			dur = *r.Duration
		}
		w.Write([]string{r.Start.Format(time.RFC3339), r.End.Format(time.RFC3339), dur, fmt.Sprintf("%t", r.Nap), csvSafe(r.Notes)})
	}
	return nil
}

func (h *ExportHandler) exportChanges(w *csv.Writer, childID int) error {
	w.Write([]string{"Time", "Wet", "Solid", "Color", "Notes"})
	var rows []models.Change
	if err := h.db.Select(&rows, `SELECT * FROM changes WHERE child_id = $1 ORDER BY time DESC`, childID); err != nil {
		return fmt.Errorf("query changes: %w", err)
	}
	for _, r := range rows {
		w.Write([]string{r.Time.Format(time.RFC3339), fmt.Sprintf("%t", r.Wet), fmt.Sprintf("%t", r.Solid), r.Color, csvSafe(r.Notes)})
	}
	return nil
}

func (h *ExportHandler) exportTummyTimes(w *csv.Writer, childID int) error {
	w.Write([]string{"Start", "End", "Duration", "Milestone", "Notes"})
	var rows []models.TummyTime
	if err := h.db.Select(&rows, `SELECT * FROM tummy_times WHERE child_id = $1 ORDER BY start_time DESC`, childID); err != nil {
		return fmt.Errorf("query tummy times: %w", err)
	}
	for _, r := range rows {
		dur := ""
		if r.Duration != nil {
			dur = *r.Duration
		}
		w.Write([]string{r.Start.Format(time.RFC3339), r.End.Format(time.RFC3339), dur, csvSafe(r.Milestone),csvSafe(r.Notes)})
	}
	return nil
}

func (h *ExportHandler) exportTemperature(w *csv.Writer, childID int) error {
	w.Write([]string{"Time", "Temperature", "Notes"})
	var rows []models.Temperature
	if err := h.db.Select(&rows, `SELECT * FROM temperature WHERE child_id = $1 ORDER BY time DESC`, childID); err != nil {
		return fmt.Errorf("query temperature: %w", err)
	}
	for _, r := range rows {
		w.Write([]string{r.Time.Format(time.RFC3339), fmt.Sprintf("%.1f", r.Temperature), csvSafe(r.Notes)})
	}
	return nil
}

func (h *ExportHandler) exportWeight(w *csv.Writer, childID int) error {
	w.Write([]string{"Date", "Weight", "Notes"})
	var rows []models.Weight
	if err := h.db.Select(&rows, `SELECT * FROM weight WHERE child_id = $1 ORDER BY date DESC`, childID); err != nil {
		return fmt.Errorf("query weight: %w", err)
	}
	for _, r := range rows {
		w.Write([]string{r.Date, fmt.Sprintf("%.2f", r.Weight), csvSafe(r.Notes)})
	}
	return nil
}

func (h *ExportHandler) exportHeight(w *csv.Writer, childID int) error {
	w.Write([]string{"Date", "Height", "Notes"})
	var rows []models.Height
	if err := h.db.Select(&rows, `SELECT * FROM height WHERE child_id = $1 ORDER BY date DESC`, childID); err != nil {
		return fmt.Errorf("query height: %w", err)
	}
	for _, r := range rows {
		w.Write([]string{r.Date, fmt.Sprintf("%.1f", r.Height), csvSafe(r.Notes)})
	}
	return nil
}

func (h *ExportHandler) exportHeadCircumference(w *csv.Writer, childID int) error {
	w.Write([]string{"Date", "Head Circumference", "Notes"})
	var rows []models.HeadCircumference
	if err := h.db.Select(&rows, `SELECT * FROM head_circumference WHERE child_id = $1 ORDER BY date DESC`, childID); err != nil {
		return fmt.Errorf("query head circumference: %w", err)
	}
	for _, r := range rows {
		w.Write([]string{r.Date, fmt.Sprintf("%.1f", r.HeadCircumference), csvSafe(r.Notes)})
	}
	return nil
}

// Pumping and uneaten milk are exported together with the bottle feeds above
// because those three are what the milk-stock balance is computed from —
// exporting one without the others leaves the figure unreconstructable.
func (h *ExportHandler) exportPumping(w *csv.Writer, childID int) error {
	w.Write([]string{"Start", "End", "Amount", "Duration"})
	var rows []models.Pumping
	if err := h.db.Select(&rows, `SELECT * FROM pumping WHERE child_id = $1 ORDER BY start_time DESC`, childID); err != nil {
		return fmt.Errorf("query pumping: %w", err)
	}
	for _, r := range rows {
		amount := ""
		if r.Amount != nil {
			amount = fmt.Sprintf("%.1f", *r.Amount)
		}
		dur := ""
		if r.Duration != nil {
			dur = *r.Duration
		}
		w.Write([]string{r.Start.Format(time.RFC3339), r.End.Format(time.RFC3339), amount, dur})
	}
	return nil
}

func (h *ExportHandler) exportMilkWaste(w *csv.Writer, childID int) error {
	w.Write([]string{"Time", "Amount", "Notes"})
	var rows []models.MilkWaste
	if err := h.db.Select(&rows, `SELECT * FROM milk_waste WHERE child_id = $1 ORDER BY time DESC`, childID); err != nil {
		return fmt.Errorf("query milk waste: %w", err)
	}
	for _, r := range rows {
		w.Write([]string{r.Time.Format(time.RFC3339), fmt.Sprintf("%.1f", r.Amount), csvSafe(r.Notes)})
	}
	return nil
}

func (h *ExportHandler) exportMedications(w *csv.Writer, childID int) error {
	w.Write([]string{"Time", "Name", "Dosage", "Unit", "Notes"})
	var rows []models.Medication
	if err := h.db.Select(&rows, `SELECT * FROM medications WHERE child_id = $1 ORDER BY time DESC`, childID); err != nil {
		return fmt.Errorf("query medications: %w", err)
	}
	for _, r := range rows {
		w.Write([]string{r.Time.Format(time.RFC3339), csvSafe(r.Name), csvSafe(r.Dosage), r.DosageUnit, csvSafe(r.Notes)})
	}
	return nil
}

func (h *ExportHandler) exportMilestones(w *csv.Writer, childID int) error {
	w.Write([]string{"Date", "Title", "Category", "Description"})
	var rows []models.Milestone
	if err := h.db.Select(&rows, `SELECT * FROM milestones WHERE child_id = $1 ORDER BY date DESC`, childID); err != nil {
		return fmt.Errorf("query milestones: %w", err)
	}
	for _, r := range rows {
		w.Write([]string{r.Date, csvSafe(r.Title), r.Category, csvSafe(r.Description)})
	}
	return nil
}

func (h *ExportHandler) exportAll(w *csv.Writer, childID int) error {
	w.Write([]string{"--- FEEDINGS ---"})
	if err := h.exportFeedings(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- SLEEP ---"})
	if err := h.exportSleep(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- DIAPER CHANGES ---"})
	if err := h.exportChanges(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- TUMMY TIME ---"})
	if err := h.exportTummyTimes(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- TEMPERATURE ---"})
	if err := h.exportTemperature(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- WEIGHT ---"})
	if err := h.exportWeight(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- HEIGHT ---"})
	if err := h.exportHeight(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- HEAD CIRCUMFERENCE ---"})
	if err := h.exportHeadCircumference(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- PUMPING ---"})
	if err := h.exportPumping(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- UNEATEN MILK ---"})
	if err := h.exportMilkWaste(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- MEDICATIONS ---"})
	if err := h.exportMedications(w, childID); err != nil {
		return err
	}
	w.Write([]string{""})
	w.Write([]string{"--- MILESTONES ---"})
	if err := h.exportMilestones(w, childID); err != nil {
		return err
	}
	return nil
}
