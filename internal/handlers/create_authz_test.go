package handlers

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/middleware"
)

// createEndpoints is every handler that saves a new row under a child named
// in the request body: its handler, the table it writes to, and the rest of
// a body it accepts. A new create endpoint belongs in this list.
var createEndpoints = []struct {
	name   string
	table  string
	create func(db *sqlx.DB) http.HandlerFunc
	fields string
}{
	{"feeding", "feedings", func(db *sqlx.DB) http.HandlerFunc { return NewFeedingsHandler(db).Create },
		`"start":"2026-01-02T08:00:00","end":"2026-01-02T08:15:00","type":"breast milk","method":"bottle","amount":120`},
	{"sleep", "sleep", func(db *sqlx.DB) http.HandlerFunc { return NewSleepHandler(db).Create },
		`"start":"2026-01-02T09:00:00","end":"2026-01-02T10:00:00","nap":true`},
	{"diaper", "changes", func(db *sqlx.DB) http.HandlerFunc { return NewChangesHandler(db).Create },
		`"time":"2026-01-02T08:00:00","wet":true,"solid":false`},
	{"tummy time", "tummy_times", func(db *sqlx.DB) http.HandlerFunc { return NewTummyTimesHandler(db).Create },
		`"start":"2026-01-02T11:00:00","end":"2026-01-02T11:10:00"`},
	{"temperature", "temperature", func(db *sqlx.DB) http.HandlerFunc { return NewTemperatureHandler(db).Create },
		`"time":"2026-01-02T08:00:00","temperature":36.8`},
	{"weight", "weight", func(db *sqlx.DB) http.HandlerFunc { return NewWeightHandler(db).Create },
		`"date":"2026-01-02","weight":4.2`},
	{"height", "height", func(db *sqlx.DB) http.HandlerFunc { return NewHeightHandler(db).Create },
		`"date":"2026-01-02","height":55`},
	{"head circumference", "head_circumference", func(db *sqlx.DB) http.HandlerFunc { return NewHeadCircumferenceHandler(db).Create },
		`"date":"2026-01-02","head_circumference":38`},
	{"pumping", "pumping", func(db *sqlx.DB) http.HandlerFunc { return NewPumpingHandler(db).Create },
		`"start":"2026-01-02T12:00:00","end":"2026-01-02T12:15:00","amount":90`},
	{"bmi", "bmi", func(db *sqlx.DB) http.HandlerFunc { return NewBMIHandler(db).Create },
		`"date":"2026-01-02","bmi":15.5`},
	{"medication", "medications", func(db *sqlx.DB) http.HandlerFunc { return NewMedicationsHandler(db).Create },
		`"time":"2026-01-02T08:00:00","name":"Vitamin D","dosage":"1","dosage_unit":"drop"`},
	{"milestone", "milestones", func(db *sqlx.DB) http.HandlerFunc { return NewMilestonesHandler(db).Create },
		`"date":"2026-01-02","title":"First smile"`},
	{"note", "notes", func(db *sqlx.DB) http.HandlerFunc { return NewNotesHandler(db).Create },
		`"time":"2026-01-02T08:00:00","note":"Slept well"`},
	{"timer", "timers", func(db *sqlx.DB) http.HandlerFunc { return NewTimersHandler(db).Create },
		`"name":"sleep"`},
	{"uneaten milk", "milk_waste", func(db *sqlx.DB) http.HandlerFunc { return NewMilkWasteHandler(db).Create },
		`"time":"2026-01-02T08:00:00","amount":30`},
}

// createFeatures is every permission a create endpoint can be guarded by.
var createFeatures = []string{
	"feeding", "sleep", "diaper", "tummy", "temp", "weight", "height",
	"headcirc", "pumping", "bmi", "medication", "milestone", "note",
}

// postAs calls a handler directly as userID, the way it runs behind the Auth
// middleware. Nothing else stands in front of it here: no RBAC middleware has
// looked at the request, so whatever is refused is refused by the handler.
func postAs(fn http.HandlerFunc, userID int, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), middleware.UserIDKey, userID)
	rec := httptest.NewRecorder()
	fn(rec, req.WithContext(ctx))
	return rec
}

func rowsFor(t *testing.T, db *sqlx.DB, table string, childID int) int {
	t.Helper()
	var n int
	if err := db.Get(&n, "SELECT count(*) FROM "+table+" WHERE child_id = $1", childID); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

// TestCreateChecksTheChildItSavesUnder is the create-side counterpart of
// TestFeedingUpdateOwnership. A create has no existing row to look its child
// up from, so every create handler checks the child it decoded from the body
// itself: write access to one child must not be enough to add to another's
// log, whatever the middleware in front made of the request.
func TestCreateChecksTheChildItSavesUnder(t *testing.T) {
	db := setupDB(t)

	mine := mkChild(t, db, "Aria")
	other := mkChild(t, db, "Bo")

	writeRole := mkRole(t, db, "writer")
	readRole := mkRole(t, db, "reader")
	for _, feature := range createFeatures {
		grantPerm(t, db, writeRole, feature, "write")
		grantPerm(t, db, readRole, feature, "read")
	}
	caregiver := mkUser(t, db, "caregiver", false)
	grantChild(t, db, caregiver, mine, writeRole)
	reader := mkUser(t, db, "reader", false)
	grantChild(t, db, reader, mine, readRole)
	admin := mkUser(t, db, "admin", true)

	for _, e := range createEndpoints {
		t.Run(e.name, func(t *testing.T) {
			create := e.create(db)
			body := func(childID int) string { return fmt.Sprintf(`{"child":%d,%s}`, childID, e.fields) }
			attempt := func(who string, userID, childID, want, wantRows int) {
				t.Helper()
				rec := postAs(create, userID, "/api/x/", body(childID))
				if rec.Code != want {
					t.Errorf("%s: got %d, want %d (body: %s)", who, rec.Code, want, rec.Body.String())
				}
				if got := rowsFor(t, db, e.table, childID); got != wantRows {
					t.Errorf("%s: %d rows in %s for that child afterwards, want %d", who, got, e.table, wantRows)
				}
			}

			attempt("no access to the other child", caregiver, other, http.StatusForbidden, 0)
			attempt("read-only access is not enough", reader, mine, http.StatusForbidden, 0)
			attempt("write access to own child", caregiver, mine, http.StatusCreated, 1)
			attempt("an admin may write to any child", admin, other, http.StatusCreated, 1)
		})
	}
}

// An entry made from a timer takes its start from the timer and uses it up.
// The timer has to be the same child's: being allowed to write to one child
// must not let anyone read off, or stop, a timer running for another.
func TestEntryFromAnotherChildsTimerIsRefused(t *testing.T) {
	for _, e := range []struct {
		name, table, timer string
		create             func(db *sqlx.DB) http.HandlerFunc
	}{
		{"feeding", "feedings", "feeding", func(db *sqlx.DB) http.HandlerFunc { return NewFeedingsHandler(db).Create }},
		{"sleep", "sleep", "sleep", func(db *sqlx.DB) http.HandlerFunc { return NewSleepHandler(db).Create }},
		{"tummy time", "tummy_times", "tummy", func(db *sqlx.DB) http.HandlerFunc { return NewTummyTimesHandler(db).Create }},
	} {
		t.Run(e.name, func(t *testing.T) {
			db := setupDB(t)
			mine := mkChild(t, db, "Aria")
			other := mkChild(t, db, "Bo")
			role := mkRole(t, db, "writer")
			for _, feature := range createFeatures {
				grantPerm(t, db, role, feature, "write")
			}
			// Even someone who may write to both children: the timer and
			// the entry still have to be for the same one.
			both := mkUser(t, db, "both", false)
			grantChild(t, db, both, mine, role)
			grantChild(t, db, both, other, role)
			onlyMine := mkUser(t, db, "only-mine", false)
			grantChild(t, db, onlyMine, mine, role)

			timer := func(childID int) int {
				t.Helper()
				var id int
				if err := db.Get(&id, `INSERT INTO timers (child_id, name, start_time) VALUES ($1, $2, $3) RETURNING id`,
					childID, e.timer, time.Now().Add(-20*time.Minute)); err != nil {
					t.Fatalf("insert timer: %v", err)
				}
				return id
			}
			running := func(id int) bool {
				t.Helper()
				var n int
				if err := db.Get(&n, `SELECT count(*) FROM timers WHERE id = $1`, id); err != nil {
					t.Fatal(err)
				}
				return n == 1
			}
			create := e.create(db)
			theirs := timer(other)

			for _, user := range []struct {
				name string
				id   int
			}{{"write access to this child only", onlyMine}, {"write access to both children", both}} {
				rec := postAs(create, user.id, "/api/x/", fmt.Sprintf(`{"child":%d,"timer":%d}`, mine, theirs))
				if rec.Code != http.StatusBadRequest {
					t.Errorf("%s: an entry from the other child's timer got %d, want 400 (body: %s)", user.name, rec.Code, rec.Body.String())
				}
				if got := rowsFor(t, db, e.table, mine); got != 0 {
					t.Errorf("%s: %d rows were stored", user.name, got)
				}
				if !running(theirs) {
					t.Fatalf("%s: the other child's timer was used up", user.name)
				}
			}

			// The child's own timer still works, and is used up by it.
			own := timer(mine)
			if rec := postAs(create, onlyMine, "/api/x/", fmt.Sprintf(`{"child":%d,"timer":%d}`, mine, own)); rec.Code != http.StatusCreated {
				t.Fatalf("an entry from the child's own timer got %d, want 201 (body: %s)", rec.Code, rec.Body.String())
			}
			if running(own) || rowsFor(t, db, e.table, mine) != 1 {
				t.Errorf("the child's own timer should be used up and one row stored")
			}
		})
	}
}
