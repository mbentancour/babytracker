package handlers

import (
	"math"

	"github.com/jmoiron/sqlx"
)

// The two sides of one entry: how much each breast gave in a pumping session,
// and how long each took in a feed on both.
//
// A pumping session keeps one rule: when it has sides, `amount` is their sum.
// Everything that reads a session (the charts, the milk stock, the Home
// Assistant sensors) reads `amount`, so the sides can never disagree with the
// figure shown everywhere else.

// bothBreasts is the one feeding method that has two sides to tell apart.
const bothBreasts = "both breasts"

// sideSum adds up the two sides of a pumping session; a side that was not
// given counts as nothing. Rounded, so that 0.1 + 0.2 is stored as 0.3.
func sideSum(left, right *float64) float64 {
	var sum float64
	if left != nil {
		sum += *left
	}
	if right != nil {
		sum += *right
	}
	return math.Round(sum*1e4) / 1e4
}

// sameAmount says whether two amounts are the same figure, give or take what
// arithmetic on decimals leaves behind.
func sameAmount(a, b float64) bool {
	return math.Abs(a-b) < 1e-4
}

// validSideAmount accepts a side that was left out, or zero or more.
func validSideAmount(v *float64) bool {
	return v == nil || (*v >= 0 && !math.IsInf(*v, 0) && !math.IsNaN(*v))
}

// sideAmount reads one side from a PATCH body: null, or a number of zero or
// more.
func sideAmount(v any) (*float64, bool) {
	if v == nil {
		return nil, true
	}
	n, ok := v.(float64)
	if !ok || n < 0 {
		return nil, false
	}
	return &n, true
}

// sqlAmount is a side as a query argument: NULL when there is none.
func sqlAmount(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

// pumpingSideUpdates works out what a PATCH means for a session's sides and
// its total, and adds that to updates. It returns a message when the body is
// not acceptable.
//
//   - A side in the body: the sides are as the body leaves them (one that is
//     not mentioned keeps its value), and the total is their sum. With both
//     sides cleared the total is whatever the body says, or stays.
//   - Only the total: it was restated without its sides. If it is no longer
//     what they add up to, they are cleared instead of being left to disagree
//     with it.
func pumpingSideUpdates(db *sqlx.DB, id int, body, updates map[string]any) (string, error) {
	rawLeft, setsLeft := body["amount_left"]
	rawRight, setsRight := body["amount_right"]
	rawAmount, setsAmount := body["amount"]
	if !setsLeft && !setsRight && !setsAmount {
		return "", nil
	}

	var current struct {
		Left  *float64 `db:"amount_left"`
		Right *float64 `db:"amount_right"`
	}
	if err := db.Get(&current, `SELECT amount_left, amount_right FROM pumping WHERE id = $1`, id); err != nil {
		return "", err
	}

	if !setsLeft && !setsRight {
		if current.Left == nil && current.Right == nil {
			return "", nil
		}
		amount, ok := rawAmount.(float64)
		if !ok || !sameAmount(amount, sideSum(current.Left, current.Right)) {
			updates["amount_left"] = nil
			updates["amount_right"] = nil
		}
		return "", nil
	}

	left, right := current.Left, current.Right
	if setsLeft {
		v, ok := sideAmount(rawLeft)
		if !ok {
			return "amount_left must be zero or more", nil
		}
		left = v
	}
	if setsRight {
		v, ok := sideAmount(rawRight)
		if !ok {
			return "amount_right must be zero or more", nil
		}
		right = v
	}
	updates["amount_left"] = sqlAmount(left)
	updates["amount_right"] = sqlAmount(right)
	if left != nil || right != nil {
		updates["amount"] = sideSum(left, right)
	}
	return "", nil
}

// validSideSeconds accepts a side that was left out, or zero or more seconds.
func validSideSeconds(v *int) bool {
	return v == nil || *v >= 0
}

// sideSeconds reports whether a PATCH body's value for one side is null or a
// whole number of seconds, zero or more. A key that is absent is fine too.
func sideSeconds(body map[string]any, key string) bool {
	v, ok := body[key]
	if !ok || v == nil {
		return true
	}
	seconds, ok := v.(float64)
	return ok && seconds >= 0 && seconds == math.Trunc(seconds)
}

// feedingSideUpdates keeps the two sides to the one method that has them: a
// PATCH that leaves a feed as anything but both breasts clears them, whether
// it changed the method or tried to set a side on a one-sided feed.
func feedingSideUpdates(db *sqlx.DB, id int, body, updates map[string]any) error {
	_, setsLeft := body["left_seconds"]
	_, setsRight := body["right_seconds"]
	rawMethod, setsMethod := body["method"]
	if !setsLeft && !setsRight && !setsMethod {
		return nil
	}
	method, _ := rawMethod.(string)
	if !setsMethod {
		if err := db.Get(&method, `SELECT method FROM feedings WHERE id = $1`, id); err != nil {
			return err
		}
	}
	if method != bothBreasts {
		updates["left_seconds"] = nil
		updates["right_seconds"] = nil
	}
	return nil
}
