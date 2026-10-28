package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
)

// createSleepFromTimerWithEnd posts {child, timer, end} to SleepHandler.Create
// the way the entry form does when the end time was edited after stopping.
func createSleepFromTimerWithEnd(t *testing.T, db *sqlx.DB, userID, childID, timerID int, end time.Time) (models.Sleep, *httptest.ResponseRecorder) {
	t.Helper()
	body := fmt.Sprintf(`{"child":%d,"timer":%d,"end":%q}`, childID, timerID, end.UTC().Format("2006-01-02T15:04:05"))
	req := httptest.NewRequest(http.MethodPost, "/api/sleep/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), middleware.UserIDKey, userID)
	rec := httptest.NewRecorder()
	NewSleepHandler(db).Create(rec, req.WithContext(ctx))
	var s models.Sleep
	if rec.Code == http.StatusCreated {
		if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
			t.Fatalf("decode sleep: %v", err)
		}
	}
	return s, rec
}

// insertTimerWithPauses inserts a sleep timer starting at `start` with the given
// pauses (pairs of start/end; a zero end means an open pause).
func insertTimerWithPauses(t *testing.T, db *sqlx.DB, child int, start time.Time, paused bool, pauses ...[2]time.Time) int {
	t.Helper()
	parts := make([]string, 0, len(pauses))
	for _, p := range pauses {
		endJSON := "null"
		if !p[1].IsZero() {
			endJSON = fmt.Sprintf(`%q`, p[1].UTC().Format(time.RFC3339Nano))
		}
		parts = append(parts, fmt.Sprintf(`{"start":%q,"end":%s}`, p[0].UTC().Format(time.RFC3339Nano), endJSON))
	}
	pausesJSON := "[" + strings.Join(parts, ",") + "]"
	var id int
	err := db.Get(&id, `
		INSERT INTO timers (child_id, name, start_time, is_paused, pauses)
		VALUES ($1, 'sleep', $2, $3, $4::jsonb)
		RETURNING id`,
		child, start, paused, pausesJSON)
	if err != nil {
		t.Fatalf("insert timer: %v", err)
	}
	return id
}

// A timer started 30 minutes ago, saved with its end moved to 10 minutes ago:
// the entry ends at the chosen time and lasts 20 minutes.
func TestSleepFromTimerHonorsEnd(t *testing.T) {
	db := setupDB(t)
	child := mkChild(t, db, "Pia")
	now := time.Now()
	timerID := insertTimerWithPauses(t, db, child, now.Add(-30*time.Minute), false)
	end := now.Add(-10 * time.Minute).Truncate(time.Second)

	s, rec := createSleepFromTimerWithEnd(t, db, mkWriter(t, db, child), child, timerID, end)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create sleep: %d %s", rec.Code, rec.Body.String())
	}
	if !s.End.Equal(end) {
		t.Errorf("end = %v, want %v", s.End, end)
	}
	if got := durationSeconds(t, db, s.ID); !within(got, 20*60, 2) {
		t.Errorf("duration = %ds, want ~1200s", got)
	}
}

// An end earlier than the timer start is refused and the timer is kept.
func TestSleepFromTimerRejectsEndBeforeStart(t *testing.T) {
	db := setupDB(t)
	child := mkChild(t, db, "Pia")
	now := time.Now()
	timerID := insertTimerWithPauses(t, db, child, now.Add(-30*time.Minute), false)

	_, rec := createSleepFromTimerWithEnd(t, db, mkWriter(t, db, child), child, timerID, now.Add(-40*time.Minute))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
	var n int
	if err := db.Get(&n, `SELECT count(*) FROM timers WHERE id = $1`, timerID); err != nil || n != 1 {
		t.Errorf("timer should remain, count=%d err=%v", n, err)
	}
}

// An end well in the future is refused.
func TestSleepFromTimerRejectsFutureEnd(t *testing.T) {
	db := setupDB(t)
	child := mkChild(t, db, "Pia")
	now := time.Now()
	timerID := insertTimerWithPauses(t, db, child, now.Add(-30*time.Minute), false)

	_, rec := createSleepFromTimerWithEnd(t, db, mkWriter(t, db, child), child, timerID, now.Add(10*time.Minute))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%s)", rec.Code, rec.Body.String())
	}
}

// A completed pause that runs past the chosen end counts only up to that end.
func TestSleepFromTimerClipsPauseToEnd(t *testing.T) {
	db := setupDB(t)
	child := mkChild(t, db, "Pia")
	now := time.Now()
	timerID := insertTimerWithPauses(t, db, child, now.Add(-30*time.Minute), false,
		[2]time.Time{now.Add(-20 * time.Minute), now.Add(-5 * time.Minute)})
	end := now.Add(-10 * time.Minute).Truncate(time.Second)

	s, rec := createSleepFromTimerWithEnd(t, db, mkWriter(t, db, child), child, timerID, end)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create sleep: %d %s", rec.Code, rec.Body.String())
	}
	// Pause counts from -20m to the end at -10m: 10 minutes.
	if !within(s.PausedSeconds, 600, 2) {
		t.Errorf("paused_seconds = %d, want ~600", s.PausedSeconds)
	}
	// Span -30m..-10m is 20 minutes, minus 10 minutes paused.
	if got := durationSeconds(t, db, s.ID); !within(got, 10*60, 3) {
		t.Errorf("duration = %ds, want ~600s", got)
	}
}

// A pause that starts after the chosen end is ignored entirely.
func TestSleepFromTimerIgnoresPauseAfterEnd(t *testing.T) {
	db := setupDB(t)
	child := mkChild(t, db, "Pia")
	now := time.Now()
	timerID := insertTimerWithPauses(t, db, child, now.Add(-30*time.Minute), true,
		[2]time.Time{now.Add(-5 * time.Minute), time.Time{}})
	end := now.Add(-10 * time.Minute).Truncate(time.Second)

	s, rec := createSleepFromTimerWithEnd(t, db, mkWriter(t, db, child), child, timerID, end)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create sleep: %d %s", rec.Code, rec.Body.String())
	}
	if s.PausedSeconds != 0 {
		t.Errorf("paused_seconds = %d, want 0", s.PausedSeconds)
	}
}
