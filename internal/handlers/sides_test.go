package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/models"
)

// mkSidesWriter is a user who may write feeds and pumping for `child`.
func mkSidesWriter(t *testing.T, db *sqlx.DB, child int) int {
	t.Helper()
	role := mkRole(t, db, "sides")
	grantPerm(t, db, role, "pumping", "write")
	grantPerm(t, db, role, "feeding", "write")
	user := mkUser(t, db, "sides", false)
	grantChild(t, db, user, child, role)
	return user
}

// patchAs calls an Update handler as userID for the row `id`.
func patchAs(fn http.HandlerFunc, userID, id int, body string) *httptest.ResponseRecorder {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", strconv.Itoa(id))
	req := httptest.NewRequest(http.MethodPatch, "/"+strconv.Itoa(id)+"/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	ctx = context.WithValue(ctx, middleware.UserIDKey, userID)
	rec := httptest.NewRecorder()
	fn(rec, req.WithContext(ctx))
	return rec
}

// amounts is a pumping session's total and sides as text, "-" for none:
// "90 40 50".
func amounts(p models.Pumping) string {
	text := func(v *float64) string {
		if v == nil {
			return "-"
		}
		return strconv.FormatFloat(*v, 'f', -1, 64)
	}
	return text(p.Amount) + " " + text(p.AmountLeft) + " " + text(p.AmountRight)
}

// seconds is a feed's two sides as text: "600 480", "-" for none.
func seconds(f models.Feeding) string {
	text := func(v *int) string {
		if v == nil {
			return "-"
		}
		return strconv.Itoa(*v)
	}
	return text(f.LeftSeconds) + " " + text(f.RightSeconds)
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	return out
}

const pumpSpan = `"start":"2026-01-02T12:00:00","end":"2026-01-02T12:15:00"`

// A session logged side by side: the sides are saved, and the total is
// theirs — whatever the request said it was.
func TestPumpingCreateAddsUpItsSides(t *testing.T) {
	db := setupDB(t)
	h := NewPumpingHandler(db)
	child := mkChild(t, db, "Aria")
	user := mkSidesWriter(t, db, child)

	cases := []struct {
		name   string
		fields string
		code   int
		want   string
	}{
		{"both sides", `"amount_left":40,"amount_right":50`, http.StatusCreated, "90 40 50"},
		{"the sides win over a total sent with them", `"amount":10,"amount_left":40,"amount_right":50`, http.StatusCreated, "90 40 50"},
		{"one side", `"amount_right":60`, http.StatusCreated, "60 - 60"},
		{"decimals add up cleanly", `"amount_left":0.1,"amount_right":0.2`, http.StatusCreated, "0.3 0.1 0.2"},
		{"a total alone, as before", `"amount":90`, http.StatusCreated, "90 - -"},
		{"nothing measured, as before", `"amount":null`, http.StatusCreated, "- - -"},
		{"a negative side", `"amount_left":-5,"amount_right":50`, http.StatusBadRequest, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := postAs(h.Create, user, "/api/pumping/", fmt.Sprintf(`{"child":%d,%s,%s}`, child, pumpSpan, c.fields))
			if rec.Code != c.code {
				t.Fatalf("got %d, want %d (body: %s)", rec.Code, c.code, rec.Body.String())
			}
			if c.code != http.StatusCreated {
				return
			}
			if got := amounts(decode[models.Pumping](t, rec)); got != c.want {
				t.Errorf("total and sides %q, want %q", got, c.want)
			}
		})
	}
}

// Whatever a PATCH changes, a session's sides and its total never disagree:
// changing a side moves the total, and restating the total alone drops sides
// that no longer add up to it.
func TestPumpingUpdateKeepsSidesAndTotalTogether(t *testing.T) {
	db := setupDB(t)
	h := NewPumpingHandler(db)
	child := mkChild(t, db, "Aria")
	user := mkSidesWriter(t, db, child)

	withSides := func(t *testing.T) int {
		t.Helper()
		rec := postAs(h.Create, user, "/api/pumping/", fmt.Sprintf(`{"child":%d,%s,"amount_left":40,"amount_right":50}`, child, pumpSpan))
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		return decode[models.Pumping](t, rec).ID
	}
	plain := func(t *testing.T) int {
		t.Helper()
		rec := postAs(h.Create, user, "/api/pumping/", fmt.Sprintf(`{"child":%d,%s,"amount":90}`, child, pumpSpan))
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		return decode[models.Pumping](t, rec).ID
	}

	cases := []struct {
		name  string
		start func(*testing.T) int
		body  string
		code  int
		want  string
	}{
		{"one side changed: the other stays, the total follows", withSides, `{"amount_left":45}`, http.StatusOK, "95 45 50"},
		{"both sides changed", withSides, `{"amount_left":30,"amount_right":35}`, http.StatusOK, "65 30 35"},
		{"the sides win over a total sent with them", withSides, `{"amount":1,"amount_left":30,"amount_right":35}`, http.StatusOK, "65 30 35"},
		{"one side cleared", withSides, `{"amount_right":null}`, http.StatusOK, "40 40 -"},
		{"both sides cleared: the total stays", withSides, `{"amount_left":null,"amount_right":null}`, http.StatusOK, "90 - -"},
		{"both sides cleared, with a new total", withSides, `{"amount":70,"amount_left":null,"amount_right":null}`, http.StatusOK, "70 - -"},
		{"the same total again: the sides stay", withSides, `{"amount":90}`, http.StatusOK, "90 40 50"},
		{"another total alone: the sides go", withSides, `{"amount":120}`, http.StatusOK, "120 - -"},
		{"the total cleared: the sides go", withSides, `{"amount":null}`, http.StatusOK, "- - -"},
		{"only the time moved: nothing else changes", withSides, `{"start":"2026-01-02T11:55:00"}`, http.StatusOK, "90 40 50"},
		{"sides given to a session that had none", plain, `{"amount_left":30,"amount_right":40}`, http.StatusOK, "70 30 40"},
		{"a total alone on a session with none, as before", plain, `{"amount":100}`, http.StatusOK, "100 - -"},
		{"a negative side", withSides, `{"amount_left":-1}`, http.StatusBadRequest, ""},
		{"a side that is not a number", withSides, `{"amount_right":"lots"}`, http.StatusBadRequest, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id := c.start(t)
			rec := patchAs(h.Update, user, id, c.body)
			if rec.Code != c.code {
				t.Fatalf("got %d, want %d (body: %s)", rec.Code, c.code, rec.Body.String())
			}
			var saved models.Pumping
			if err := db.Get(&saved, `SELECT * FROM pumping WHERE id = $1`, id); err != nil {
				t.Fatal(err)
			}
			want := c.want
			if c.code != http.StatusOK {
				want = "90 40 50" // a refused change leaves the session alone
			}
			if got := amounts(saved); got != want {
				t.Errorf("total and sides %q, want %q", got, want)
			}
			if c.code == http.StatusOK {
				if got := amounts(decode[models.Pumping](t, rec)); got != want {
					t.Errorf("answered with %q, want %q", got, want)
				}
			}
		})
	}
}

const feedSpan = `"start":"2026-01-02T08:00:00","end":"2026-01-02T08:18:00","type":"breast milk"`

// How long each side took is kept for a feed on both breasts, and for no
// other: a one-sided feed has nothing to tell apart.
func TestFeedingSidesBelongToBothBreasts(t *testing.T) {
	db := setupDB(t)
	h := NewFeedingsHandler(db)
	child := mkChild(t, db, "Aria")
	user := mkSidesWriter(t, db, child)

	create := func(t *testing.T, fields string) *httptest.ResponseRecorder {
		t.Helper()
		return postAs(h.Create, user, "/api/feedings/", fmt.Sprintf(`{"child":%d,%s,%s}`, child, feedSpan, fields))
	}
	both := func(t *testing.T) int {
		t.Helper()
		rec := create(t, `"method":"both breasts","left_seconds":600,"right_seconds":480`)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		return decode[models.Feeding](t, rec).ID
	}
	left := func(t *testing.T) int {
		t.Helper()
		rec := create(t, `"method":"left breast"`)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		return decode[models.Feeding](t, rec).ID
	}

	t.Run("create", func(t *testing.T) {
		cases := []struct {
			name   string
			fields string
			code   int
			want   string
		}{
			{"both breasts, each side timed", `"method":"both breasts","left_seconds":600,"right_seconds":480`, http.StatusCreated, "600 480"},
			{"both breasts, one side timed", `"method":"both breasts","left_seconds":600`, http.StatusCreated, "600 -"},
			{"both breasts, no split", `"method":"both breasts"`, http.StatusCreated, "- -"},
			{"one side only: nothing to tell apart", `"method":"left breast","left_seconds":600,"right_seconds":0`, http.StatusCreated, "- -"},
			{"a bottle", `"method":"bottle","amount":120,"left_seconds":600`, http.StatusCreated, "- -"},
			{"a negative side", `"method":"both breasts","left_seconds":-1`, http.StatusBadRequest, ""},
			{"a side with a fraction", `"method":"both breasts","left_seconds":1.5`, http.StatusBadRequest, ""},
		}
		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				rec := create(t, c.fields)
				if rec.Code != c.code {
					t.Fatalf("got %d, want %d (body: %s)", rec.Code, c.code, rec.Body.String())
				}
				if c.code != http.StatusCreated {
					return
				}
				if got := seconds(decode[models.Feeding](t, rec)); got != c.want {
					t.Errorf("sides %q, want %q", got, c.want)
				}
			})
		}
	})

	t.Run("update", func(t *testing.T) {
		cases := []struct {
			name  string
			start func(*testing.T) int
			body  string
			code  int
			want  string
		}{
			{"one side corrected", both, `{"left_seconds":540}`, http.StatusOK, "540 480"},
			{"one side cleared", both, `{"right_seconds":null}`, http.StatusOK, "600 -"},
			{"no longer both breasts: the sides go", both, `{"method":"right breast"}`, http.StatusOK, "- -"},
			{"changed to a bottle with sides sent along", both, `{"method":"bottle","left_seconds":600,"right_seconds":480}`, http.StatusOK, "- -"},
			{"only the notes changed: the sides stay", both, `{"notes":"sleepy"}`, http.StatusOK, "600 480"},
			{"becomes both breasts, with its sides", left, `{"method":"both breasts","left_seconds":300,"right_seconds":420}`, http.StatusOK, "300 420"},
			{"a side on a one-sided feed is not kept", left, `{"left_seconds":300}`, http.StatusOK, "- -"},
			{"a negative side", both, `{"left_seconds":-5}`, http.StatusBadRequest, "600 480"},
			{"a side with a fraction", both, `{"right_seconds":90.5}`, http.StatusBadRequest, "600 480"},
			{"a side that is not a number", both, `{"right_seconds":"long"}`, http.StatusBadRequest, "600 480"},
		}
		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				id := c.start(t)
				rec := patchAs(h.Update, user, id, c.body)
				if rec.Code != c.code {
					t.Fatalf("got %d, want %d (body: %s)", rec.Code, c.code, rec.Body.String())
				}
				var saved models.Feeding
				if err := db.Get(&saved, `SELECT * FROM feedings WHERE id = $1`, id); err != nil {
					t.Fatal(err)
				}
				if got := seconds(saved); got != c.want {
					t.Errorf("sides %q, want %q", got, c.want)
				}
			})
		}
	})
}

// The export carries the two sides in columns of their own, after the ones
// that were already there.
func TestExportCarriesTheSides(t *testing.T) {
	db := setupDB(t)
	child := mkChild(t, db, "Aria")
	admin := mkUser(t, db, "admin", true)
	if _, err := db.Exec(`
		INSERT INTO feedings (child_id, start_time, end_time, type, method, left_seconds, right_seconds)
		VALUES ($1, '2026-01-02T08:00:00Z', '2026-01-02T08:18:00Z', 'breast milk', 'both breasts', 600, 480)`, child); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO pumping (child_id, start_time, end_time, amount, amount_left, amount_right)
		VALUES ($1, '2026-01-02T12:00:00Z', '2026-01-02T12:15:00Z', 90, 40, 50),
		       ($1, '2026-01-02T16:00:00Z', '2026-01-02T16:15:00Z', 80, NULL, NULL)`, child); err != nil {
		t.Fatal(err)
	}

	export := func(kind string) string {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/export/csv?child=%d&type=%s", child, kind), nil)
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, admin))
		rec := httptest.NewRecorder()
		NewExportHandler(db).ExportCSV(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("export %s: %d %s", kind, rec.Code, rec.Body.String())
		}
		return rec.Body.String()
	}

	feedings := export("feedings")
	for _, want := range []string{
		"Type,Start,End,Method,Amount,Duration,Notes,Left Duration,Right Duration\n",
		",00:18:00,,00:10:00,00:08:00\n",
	} {
		if !strings.Contains(feedings, want) {
			t.Errorf("feedings export is missing %q:\n%s", want, feedings)
		}
	}
	pumping := export("pumping")
	for _, want := range []string{
		"Start,End,Amount,Duration,Left Amount,Right Amount\n",
		",90.0,00:15:00,40.0,50.0\n",
		",80.0,00:15:00,,\n",
	} {
		if !strings.Contains(pumping, want) {
			t.Errorf("pumping export is missing %q:\n%s", want, pumping)
		}
	}
}
