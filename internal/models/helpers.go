package models

import (
	"fmt"
	"strings"

	"github.com/jmoiron/sqlx"
)

// buildUpdateQuery builds a dynamic UPDATE query from a map of field->value pairs.
// Only whitelisted fields should be passed in.
func buildUpdateQuery(table string, id int, updates map[string]any) (string, []any) {
	setClauses := make([]string, 0, len(updates))
	args := make([]any, 0, len(updates)+1)
	i := 1

	for field, value := range updates {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", field, i))
		args = append(args, value)
		i++
	}

	if table == "children" {
		setClauses = append(setClauses, fmt.Sprintf("updated_at = NOW()"))
	}

	query := fmt.Sprintf(
		"UPDATE %s SET %s WHERE id = $%d RETURNING *",
		table,
		strings.Join(setClauses, ", "),
		i,
	)
	args = append(args, id)

	return query, args
}

// buildUpdateQueryWithExtraCondition is like buildUpdateQuery but adds an extra
// WHERE condition (e.g., user_id check for ownership). The extraCondField must
// also be present in the updates map and is moved from SET to WHERE.
func buildUpdateQueryWithExtraCondition(table string, id int, updates map[string]any, extraCondField string) (string, []any) {
	extraVal := updates[extraCondField]
	delete(updates, extraCondField)

	setClauses := make([]string, 0, len(updates))
	args := make([]any, 0, len(updates)+2)
	i := 1

	for field, value := range updates {
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", field, i))
		args = append(args, value)
		i++
	}

	query := fmt.Sprintf(
		"UPDATE %s SET %s WHERE id = $%d AND %s = $%d RETURNING *",
		table,
		strings.Join(setClauses, ", "),
		i,
		extraCondField,
		i+1,
	)
	args = append(args, id, extraVal)

	return query, args
}

// Duration helpers for formatting intervals as HH:MM:SS strings
func FormatDuration(seconds int) string {
	h := seconds / 3600
	m := (seconds % 3600) / 60
	s := seconds % 60
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}

// deletableTables is the allow-list of tables that DeleteEntity is permitted
// to target. Keeps the fmt.Sprintf on the table name safe even if a future
// caller passes user-influenced input.
var deletableTables = map[string]bool{
	"feedings": true, "sleep": true, "changes": true, "tummy_times": true,
	"temperature": true, "weight": true, "height": true, "head_circumference": true,
	"pumping": true, "medications": true, "milestones": true, "notes": true,
	"bmi": true, "children": true,
}

// Generic delete helper. The table name is interpolated, so it must come from
// a trusted constant — enforced by an allow-list.
func DeleteEntity(db *sqlx.DB, table string, id int) error {
	if !deletableTables[table] {
		return fmt.Errorf("delete not permitted on table %q", table)
	}
	_, err := db.Exec(fmt.Sprintf("DELETE FROM %s WHERE id = $1", table), id)
	return err
}
