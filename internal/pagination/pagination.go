package pagination

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

type Response struct {
	Count    int    `json:"count"`
	Next     *string `json:"next"`
	Previous *string `json:"previous"`
	Results  any    `json:"results"`
}

type Params struct {
	Limit   int
	Offset  int
	OrderBy string
}

// AllowedOrderFields maps entity types to their allowed ordering fields and the actual DB column.
var AllowedOrderFields = map[string]map[string]string{
	"feedings":           {"start": "start_time", "end": "end_time", "type": "type", "method": "method"},
	"sleep":              {"start": "start_time", "end": "end_time"},
	"changes":            {"time": "time"},
	"tummy_times":        {"start": "start_time", "end": "end_time"},
	"temperature":        {"time": "time", "temperature": "temperature"},
	"weight":             {"date": "date", "weight": "weight"},
	"height":             {"date": "date", "height": "height"},
	"pumping":            {"start": "start_time", "end": "end_time"},
	"notes":              {"time": "time"},
	"timers":             {"start": "start_time"},
	"children":           {"first_name": "first_name", "id": "id"},
	"head_circumference": {"date": "date", "head_circumference": "head_circumference"},
	"medications":        {"time": "time", "name": "name"},
	"milestones":         {"date": "date", "title": "title", "category": "category"},
	"bmi":                {"date": "date", "bmi": "bmi"},
}

func ParseParams(r *http.Request, entity string) Params {
	p := Params{Limit: 100, Offset: 0}

	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			p.Limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		// Cap offset to prevent expensive deep-paginated scans on large tables.
		if n, err := strconv.Atoi(v); err == nil && n >= 0 && n <= 100000 {
			p.Offset = n
		}
	}

	if v := r.URL.Query().Get("ordering"); v != "" {
		desc := false
		field := v
		if strings.HasPrefix(v, "-") {
			desc = true
			field = v[1:]
		}
		if allowed, ok := AllowedOrderFields[entity]; ok {
			if col, valid := allowed[field]; valid {
				if desc {
					p.OrderBy = col + " DESC"
				} else {
					p.OrderBy = col + " ASC"
				}
			}
		}
	}

	return p
}

type FilterConfig struct {
	Table        string
	ChildIDField string            // "child_id"
	TimeFields   map[string]string // query param -> db column, e.g. "start_min" -> "start_time"
	DateFields   map[string]string // query param -> db column, e.g. "date_min" -> "date"

	// AccessibleChildren MUST be populated by the caller with the set of
	// child IDs the authenticated user is allowed to see. An empty slice
	// means "no access" — the query is constrained to return zero rows.
	// Admins should pass the full set from models.GetAccessibleChildIDs.
	AccessibleChildren []int
}

type QueryResult struct {
	WhereClause string
	Args        []any
	CountQuery  string
	SelectQuery string
}

func BuildQuery(r *http.Request, fc FilterConfig, pp Params) QueryResult {
	var conditions []string
	var args []any

	// Mandatory ownership scope: never return rows outside the caller's
	// accessible child set. Empty slice = no access = match nothing.
	if len(fc.AccessibleChildren) == 0 {
		conditions = append(conditions, "1=0")
	} else {
		placeholders := make([]string, len(fc.AccessibleChildren))
		for i, id := range fc.AccessibleChildren {
			placeholders[i] = "?"
			args = append(args, id)
		}
		conditions = append(conditions,
			fmt.Sprintf("%s IN (%s)", fc.ChildIDField, strings.Join(placeholders, ",")))
	}

	// Optional narrower ?child=N filter — intersects with the accessible
	// set above, so it can only ever narrow, never widen, what the user
	// can see.
	if v := r.URL.Query().Get("child"); v != "" {
		if childID, err := strconv.Atoi(v); err == nil {
			conditions = append(conditions, fmt.Sprintf("%s = ?", fc.ChildIDField))
			args = append(args, childID)
		}
	}

	// Time range filters (start_min, start_max, date_min, date_max)
	for param, col := range fc.TimeFields {
		if v := r.URL.Query().Get(param); v != "" {
			if strings.HasSuffix(param, "_min") {
				conditions = append(conditions, fmt.Sprintf("%s >= ?", col))
			} else {
				conditions = append(conditions, fmt.Sprintf("%s <= ?", col))
			}
			args = append(args, v)
		}
	}

	for param, col := range fc.DateFields {
		if v := r.URL.Query().Get(param); v != "" {
			if strings.HasSuffix(param, "_min") {
				conditions = append(conditions, fmt.Sprintf("%s >= ?", col))
			} else {
				conditions = append(conditions, fmt.Sprintf("%s <= ?", col))
			}
			args = append(args, v)
		}
	}

	where := ""
	if len(conditions) > 0 {
		where = " WHERE " + strings.Join(conditions, " AND ")
	}

	orderBy := "id DESC"
	if pp.OrderBy != "" {
		orderBy = pp.OrderBy
	}

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM %s%s", fc.Table, where)
	selectQuery := fmt.Sprintf(
		"SELECT * FROM %s%s ORDER BY %s LIMIT %d OFFSET %d",
		fc.Table, where, orderBy, pp.Limit, pp.Offset,
	)

	return QueryResult{
		WhereClause: where,
		Args:        args,
		CountQuery:  countQuery,
		SelectQuery: selectQuery,
	}
}

func Execute[T any](db *sqlx.DB, qr QueryResult) (*Response, error) {
	var count int
	if err := db.Get(&count, database.Q(db, qr.CountQuery), qr.Args...); err != nil {
		return nil, err
	}

	var results []T
	if err := db.Select(&results, database.Q(db, qr.SelectQuery), qr.Args...); err != nil {
		return nil, err
	}
	if results == nil {
		results = []T{}
	}

	return &Response{
		Count:    count,
		Next:     nil,
		Previous: nil,
		Results:  results,
	}, nil
}

func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func WriteError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, map[string]string{"error": message})
}
