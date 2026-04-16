package pagination

import (
	"net/http/httptest"
	"strings"
	"testing"
)

// TestBuildQuery_AlwaysScopesToAccessibleChildren is the regression guard for
// the critical list-disclosure IDOR. No matter what the caller supplies in
// ?child=, the SELECT must include a child_id IN (...) constraint keyed off
// the server-computed accessible set.
func TestBuildQuery_AlwaysScopesToAccessibleChildren(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/feedings/", nil)
	qr := BuildQuery(r, FilterConfig{
		Table:              "feedings",
		ChildIDField:       "child_id",
		AccessibleChildren: []int{1, 7, 9},
	}, Params{Limit: 100})

	if !strings.Contains(qr.SelectQuery, "child_id IN") {
		t.Fatalf("expected child_id IN clause, got: %s", qr.SelectQuery)
	}
	if len(qr.Args) < 3 {
		t.Fatalf("expected accessible ids in args, got: %v", qr.Args)
	}
}

// TestBuildQuery_EmptyAccessibleYieldsNoRows confirms that the filter defaults
// to match-nothing when the user has no accessible children — we'd rather
// return an empty list than leak any data.
func TestBuildQuery_EmptyAccessibleYieldsNoRows(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/feedings/", nil)
	qr := BuildQuery(r, FilterConfig{
		Table:              "feedings",
		ChildIDField:       "child_id",
		AccessibleChildren: nil,
	}, Params{Limit: 100})

	if !strings.Contains(qr.SelectQuery, "1=0") {
		t.Fatalf("expected 1=0 guard, got: %s", qr.SelectQuery)
	}
}

// TestBuildQuery_ExplicitChildFilterNarrowsButDoesNotWiden shows the
// ?child=N param can only narrow the result — never escape the accessible set.
func TestBuildQuery_ExplicitChildFilterNarrowsButDoesNotWiden(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/feedings/?child=99", nil)
	qr := BuildQuery(r, FilterConfig{
		Table:              "feedings",
		ChildIDField:       "child_id",
		AccessibleChildren: []int{1, 2, 3},
	}, Params{Limit: 100})

	// Both the accessible-set IN filter AND the explicit child=99 filter must
	// be present. A row with child_id=99 that isn't in {1,2,3} still cannot
	// satisfy both clauses, so access can't escape the accessible set.
	if !strings.Contains(qr.SelectQuery, "child_id IN") {
		t.Fatalf("expected accessible IN clause, got: %s", qr.SelectQuery)
	}
	if !strings.Contains(qr.SelectQuery, "child_id = $") {
		t.Fatalf("expected explicit child filter, got: %s", qr.SelectQuery)
	}
}

func TestParseParams_OffsetClampedTo100k(t *testing.T) {
	r := httptest.NewRequest("GET", "/api/feedings/?offset=999999", nil)
	p := ParseParams(r, "feedings")
	if p.Offset != 0 {
		t.Fatalf("expected offset above cap to be rejected, got %d", p.Offset)
	}

	r = httptest.NewRequest("GET", "/api/feedings/?offset=50000", nil)
	p = ParseParams(r, "feedings")
	if p.Offset != 50000 {
		t.Fatalf("expected offset within cap accepted, got %d", p.Offset)
	}
}
