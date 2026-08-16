package handlers

import (
	"context"
	"encoding/json"
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

func mkMilkWaste(t *testing.T, db *sqlx.DB, childID int, amount float64) int {
	t.Helper()
	var id int
	err := db.Get(&id, `
		INSERT INTO milk_waste (child_id, time, amount) VALUES ($1, NOW(), $2) RETURNING id`,
		childID, amount)
	if err != nil {
		t.Fatalf("mkMilkWaste: %v", err)
	}
	return id
}

func updateMilkWaste(t *testing.T, h *MilkWasteHandler, userID, id int, body string) *httptest.ResponseRecorder {
	t.Helper()
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", strconv.Itoa(id))
	req := httptest.NewRequest(http.MethodPatch, "/api/milk-waste/"+strconv.Itoa(id)+"/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rctx)
	ctx = context.WithValue(ctx, middleware.UserIDKey, userID)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	h.Update(rec, req)
	return rec
}

func getMilkStock(t *testing.T, h *MilkStockHandler, userID int, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/milk-stock"+query, nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	return rec
}

// Uneaten milk shares the pumping permission rather than having its own RBAC
// feature (see models/access.go), so this covers both that the sharing works
// and that the usual per-record ownership check is in place.
func TestMilkWasteUpdateOwnership(t *testing.T) {
	db := setupDB(t)
	h := NewMilkWasteHandler(db)

	childA := mkChild(t, db, "Aria")
	childB := mkChild(t, db, "Bo")

	writeRole := mkRole(t, db, "writer")
	grantPerm(t, db, writeRole, "pumping", "write")
	readRole := mkRole(t, db, "reader")
	grantPerm(t, db, readRole, "pumping", "read")

	caregiver := mkUser(t, db, "caregiver", false)
	grantChild(t, db, caregiver, childA, writeRole)

	reader := mkUser(t, db, "reader", false)
	grantChild(t, db, reader, childA, readRole)

	wasteA := mkMilkWaste(t, db, childA, 30)
	wasteB := mkMilkWaste(t, db, childB, 30)

	cases := []struct {
		name    string
		user    int
		wasteID int
		want    int
	}{
		{"write access to own child's row", caregiver, wasteA, http.StatusOK},
		{"no access to other child's row (IDOR)", caregiver, wasteB, http.StatusForbidden},
		{"read-only access cannot write", reader, wasteA, http.StatusForbidden},
		{"nonexistent record is 404", caregiver, 999999, http.StatusNotFound},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := updateMilkWaste(t, h, c.user, c.wasteID, `{"amount": 45}`)
			if rec.Code != c.want {
				t.Fatalf("got %d, want %d (body: %s)", rec.Code, c.want, rec.Body.String())
			}
		})
	}
}

// A non-positive amount would silently corrupt the stock balance rather than
// just leaving a field blank, so it is rejected on the edit path too — not
// only on create, where it would otherwise be trivial to work around.
func TestMilkWasteUpdateRejectsNonPositiveAmount(t *testing.T) {
	db := setupDB(t)
	h := NewMilkWasteHandler(db)

	child := mkChild(t, db, "Aria")
	role := mkRole(t, db, "writer")
	grantPerm(t, db, role, "pumping", "write")
	user := mkUser(t, db, "caregiver", false)
	grantChild(t, db, user, child, role)
	id := mkMilkWaste(t, db, child, 30)

	for _, body := range []string{`{"amount": 0}`, `{"amount": -10}`} {
		rec := updateMilkWaste(t, h, user, id, body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d, want 400", body, rec.Code)
		}
	}

	// The rejected edits must not have landed.
	var amount float64
	if err := db.Get(&amount, `SELECT amount FROM milk_waste WHERE id = $1`, id); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if amount != 30 {
		t.Fatalf("amount changed to %v despite rejected updates", amount)
	}
}

func TestMilkStockArithmetic(t *testing.T) {
	db := setupDB(t)
	child := mkChild(t, db, "Aria")

	// 200 pumped
	db.MustExec(`INSERT INTO pumping (child_id, start_time, end_time, amount)
	             VALUES ($1, NOW(), NOW(), 120), ($1, NOW(), NOW(), 80)`, child)

	// 70 out of the stash: a 50 mL expressed-milk bottle plus a 20 mL
	// fortified one, whose base is also thawed expressed milk.
	db.MustExec(`INSERT INTO feedings (child_id, start_time, end_time, type, method, amount)
	             VALUES ($1, NOW(), NOW(), 'breast milk', 'bottle', 50),
	                    ($1, NOW(), NOW(), 'fortified breast milk', 'bottle', 20)`, child)

	// Never out of the stash: nursing at the breast, and formula.
	db.MustExec(`INSERT INTO feedings (child_id, start_time, end_time, type, method, amount)
	             VALUES ($1, NOW(), NOW(), 'breast milk', 'left breast', 90),
	                    ($1, NOW(), NOW(), 'formula', 'bottle', 60)`, child)

	// 30 poured away
	mkMilkWaste(t, db, child, 30)

	stock, err := models.GetMilkStock(db, child)
	if err != nil {
		t.Fatalf("GetMilkStock: %v", err)
	}
	if stock.Pumped != 200 {
		t.Errorf("pumped = %v, want 200", stock.Pumped)
	}
	if stock.BottleFed != 70 {
		t.Errorf("bottle_fed = %v, want 70 (nursing and formula must not count)", stock.BottleFed)
	}
	if stock.Discarded != 30 {
		t.Errorf("discarded = %v, want 30", stock.Discarded)
	}
	if stock.Stock != 100 {
		t.Errorf("stock = %v, want 100", stock.Stock)
	}
}

// Another child's milk must never leak into this child's balance, and an
// empty history must read as zero rather than erroring on NULL sums.
func TestMilkStockScopingAndEmptyHistory(t *testing.T) {
	db := setupDB(t)
	childA := mkChild(t, db, "Aria")
	childB := mkChild(t, db, "Bo")

	db.MustExec(`INSERT INTO pumping (child_id, start_time, end_time, amount)
	             VALUES ($1, NOW(), NOW(), 500)`, childB)

	stock, err := models.GetMilkStock(db, childA)
	if err != nil {
		t.Fatalf("GetMilkStock: %v", err)
	}
	if stock.Pumped != 0 || stock.BottleFed != 0 || stock.Discarded != 0 || stock.Stock != 0 {
		t.Fatalf("empty history returned %+v, want all zero", stock)
	}
}

// A negative balance means something isn't being logged (nursing recorded as a
// bottle, pumping logged without amounts). That's information the household
// needs, so it is reported rather than clamped to zero.
func TestMilkStockReportsNegativeBalance(t *testing.T) {
	db := setupDB(t)
	child := mkChild(t, db, "Aria")

	db.MustExec(`INSERT INTO feedings (child_id, start_time, end_time, type, method, amount)
	             VALUES ($1, NOW(), NOW(), 'breast milk', 'bottle', 90)`, child)

	stock, err := models.GetMilkStock(db, child)
	if err != nil {
		t.Fatalf("GetMilkStock: %v", err)
	}
	if stock.Stock != -90 {
		t.Fatalf("stock = %v, want -90", stock.Stock)
	}
}

func TestMilkStockEndpointAuthorization(t *testing.T) {
	db := setupDB(t)
	h := NewMilkStockHandler(db)

	childA := mkChild(t, db, "Aria")
	childB := mkChild(t, db, "Bo")

	role := mkRole(t, db, "reader")
	grantPerm(t, db, role, "pumping", "read")
	user := mkUser(t, db, "caregiver", false)
	grantChild(t, db, user, childA, role)
	admin := mkUser(t, db, "admin", true)

	db.MustExec(`INSERT INTO pumping (child_id, start_time, end_time, amount)
	             VALUES ($1, NOW(), NOW(), 150)`, childA)

	t.Run("own child returns the balance", func(t *testing.T) {
		rec := getMilkStock(t, h, user, "?child="+strconv.Itoa(childA))
		if rec.Code != http.StatusOK {
			t.Fatalf("got %d, want 200 (body: %s)", rec.Code, rec.Body.String())
		}
		var got models.MilkStock
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if got.Stock != 150 {
			t.Fatalf("stock = %v, want 150", got.Stock)
		}
	})

	t.Run("another child is forbidden", func(t *testing.T) {
		rec := getMilkStock(t, h, user, "?child="+strconv.Itoa(childB))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("got %d, want 403", rec.Code)
		}
	})

	t.Run("missing child is a 400", func(t *testing.T) {
		if rec := getMilkStock(t, h, user, ""); rec.Code != http.StatusBadRequest {
			t.Fatalf("got %d, want 400", rec.Code)
		}
	})

	t.Run("admins reach every child", func(t *testing.T) {
		rec := getMilkStock(t, h, admin, "?child="+strconv.Itoa(childB))
		if rec.Code != http.StatusOK {
			t.Fatalf("got %d, want 200 (body: %s)", rec.Code, rec.Body.String())
		}
	})
}
