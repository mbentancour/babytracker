package handlers

import (
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Helpers the import tests share.

// String methods make failure messages show amounts rather than pointers.
func (f importFeeding) String() string {
	return fmt.Sprintf("{%s %s %s +%v amount=%s notes=%q}", f.Type, f.Method, f.Start.Format(time.RFC3339), f.End.Sub(f.Start), amountText(f.Amount), f.Notes)
}

func (pm importPumping) String() string {
	return fmt.Sprintf("{%s +%v amount=%s note=%q family=%v duplicate=%v}", pm.Start.Format(time.RFC3339), pm.End.Sub(pm.Start), amountText(pm.Amount), pm.Note, pm.Family, pm.Duplicate)
}

func amountText(v *float64) string {
	if v == nil {
		return "none"
	}
	return formatAmount(*v)
}

// at returns s[i], failing the test instead of panicking when it's missing,
// so one regression doesn't abort the rest of the package's tests.
func at[T any](t *testing.T, s []T, i int) T {
	t.Helper()
	if i >= len(s) {
		t.Fatalf("want at least %d entries, got %d: %+v", i+1, len(s), s)
	}
	return s[i]
}

func amount(t *testing.T, v *float64) float64 {
	t.Helper()
	if v == nil {
		t.Fatal("amount is nil")
	}
	return *v
}

func warningCodes(p *importPlan) []string {
	var codes []string
	for _, w := range p.Warnings {
		codes = append(codes, w.Code)
	}
	return codes
}

func noteTexts(p *importPlan) []string {
	var notes []string
	for _, n := range p.Notes {
		notes = append(notes, n.Note)
	}
	return notes
}

func importCount(t *testing.T, db interface {
	Get(dest any, query string, args ...any) error
}, query string, args ...any) int {
	t.Helper()
	var n int
	if err := db.Get(&n, query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

// importJSON reads a decoded JSON value by path ("stats.feedings",
// "rejected.0.code"), failing the test instead of panicking when it's
// missing or has another type.
func importJSON[T any](t *testing.T, v any, path string) T {
	t.Helper()
	cur := v
	for _, part := range strings.Split(path, ".") {
		switch node := cur.(type) {
		case map[string]any:
			cur = node[part]
		case []any:
			i, err := strconv.Atoi(part)
			if err != nil || i < 0 || i >= len(node) {
				t.Fatalf("%s: no index %q in a list of %d", path, part, len(node))
			}
			cur = node[i]
		default:
			t.Fatalf("%s: can't index %T", path, cur)
		}
	}
	out, ok := cur.(T)
	if !ok {
		t.Fatalf("%s is %T (%v)", path, cur, cur)
	}
	return out
}
