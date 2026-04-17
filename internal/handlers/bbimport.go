package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/pagination"
)

type BBImportHandler struct {
	db *sqlx.DB
}

func NewBBImportHandler(db *sqlx.DB) *BBImportHandler {
	return &BBImportHandler{db: db}
}

type bbImportRequest struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

type bbPage struct {
	Count   int             `json:"count"`
	Next    *string         `json:"next"`
	Results json.RawMessage `json:"results"`
}

// Import fetches all data from a Baby Buddy instance and inserts it locally.
// POST /api/import/babybuddy
func (h *BBImportHandler) Import(w http.ResponseWriter, r *http.Request) {
	if isAdmin, ok := r.Context().Value(middleware.IsAdminKey).(bool); !ok || !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req bbImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.URL == "" || req.Token == "" {
		pagination.WriteError(w, http.StatusBadRequest, "url and token are required")
		return
	}

	// SSRF protection: validate the URL is a safe external HTTP(S) address
	if err := validateBBURL(req.URL); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	stats := map[string]int{}

	// 1. Import children
	childMap := map[int]int{} // BB ID -> local ID
	children := bbFetchAll(client, req.URL, req.Token, "/api/children/")
	for _, raw := range children {
		var c struct {
			ID        int    `json:"id"`
			FirstName string `json:"first_name"`
			LastName  string `json:"last_name"`
			BirthDate string `json:"birth_date"`
		}
		json.Unmarshal(raw, &c)
		var localID int
		err := h.db.QueryRow(
			database.Q(h.db, `INSERT INTO children (first_name, last_name, birth_date) VALUES (?, ?, ?) RETURNING id`),
			c.FirstName, c.LastName, c.BirthDate,
		).Scan(&localID)
		if err != nil {
			slog.Warn("import: failed to import child", "name", c.FirstName, "error", err)
			continue
		}
		childMap[c.ID] = localID
	}
	stats["children"] = len(childMap)

	// 2. Import each entity type
	type importDef struct {
		name     string
		endpoint string
		sql      string
		extract  func(json.RawMessage, int) []any
	}

	imports := []importDef{
		{"feedings", "/api/feedings/",
			`INSERT INTO feedings (child_id, start_time, end_time, type, method, amount, duration, notes) VALUES (?,?,?,?,?,?,?,?)`,
			func(raw json.RawMessage, cid int) []any {
				var e struct {
					Start, End, Type, Method string
					Amount                   *float64
					Duration                 *string
					Notes                    string
				}
				json.Unmarshal(raw, &e)
				return []any{cid, e.Start, e.End, e.Type, e.Method, e.Amount, e.Duration, e.Notes}
			}},
		{"sleep", "/api/sleep/",
			`INSERT INTO sleep (child_id, start_time, end_time, duration, nap, notes) VALUES (?,?,?,?,?,?)`,
			func(raw json.RawMessage, cid int) []any {
				var e struct {
					Start, End string
					Duration   *string
					Nap        bool
					Notes      string
				}
				json.Unmarshal(raw, &e)
				return []any{cid, e.Start, e.End, e.Duration, e.Nap, e.Notes}
			}},
		{"changes", "/api/changes/",
			`INSERT INTO changes (child_id, time, wet, solid, color, notes) VALUES (?,?,?,?,?,?)`,
			func(raw json.RawMessage, cid int) []any {
				var e struct {
					Time, Color, Notes string
					Wet, Solid         bool
				}
				json.Unmarshal(raw, &e)
				return []any{cid, e.Time, e.Wet, e.Solid, e.Color, e.Notes}
			}},
		{"tummy-times", "/api/tummy-times/",
			`INSERT INTO tummy_times (child_id, start_time, end_time, duration, milestone, notes) VALUES (?,?,?,?,?,?)`,
			func(raw json.RawMessage, cid int) []any {
				var e struct {
					Start, End string
					Duration   *string
					Milestone  string
					Notes      string
				}
				json.Unmarshal(raw, &e)
				return []any{cid, e.Start, e.End, e.Duration, e.Milestone, e.Notes}
			}},
		{"temperature", "/api/temperature/",
			`INSERT INTO temperature (child_id, time, temperature, notes) VALUES (?,?,?,?)`,
			func(raw json.RawMessage, cid int) []any {
				var e struct {
					Time  string
					Temp  float64 `json:"temperature"`
					Notes string
				}
				json.Unmarshal(raw, &e)
				return []any{cid, e.Time, e.Temp, e.Notes}
			}},
		{"weight", "/api/weight/",
			`INSERT INTO weight (child_id, date, weight, notes) VALUES (?,?,?,?)`,
			func(raw json.RawMessage, cid int) []any {
				var e struct {
					Date   string
					Weight float64
					Notes  string
				}
				json.Unmarshal(raw, &e)
				return []any{cid, e.Date, e.Weight, e.Notes}
			}},
		{"height", "/api/height/",
			`INSERT INTO height (child_id, date, height, notes) VALUES (?,?,?,?)`,
			func(raw json.RawMessage, cid int) []any {
				var e struct {
					Date   string
					Height float64
					Notes  string
				}
				json.Unmarshal(raw, &e)
				return []any{cid, e.Date, e.Height, e.Notes}
			}},
		{"pumping", "/api/pumping/",
			`INSERT INTO pumping (child_id, start_time, end_time, amount, duration) VALUES (?,?,?,?,?)`,
			func(raw json.RawMessage, cid int) []any {
				var e struct {
					Start, End string
					Amount     *float64
					Duration   *string
				}
				json.Unmarshal(raw, &e)
				return []any{cid, e.Start, e.End, e.Amount, e.Duration}
			}},
		{"notes", "/api/notes/",
			`INSERT INTO notes (child_id, time, note) VALUES (?,?,?)`,
			func(raw json.RawMessage, cid int) []any {
				var e struct {
					Time string
					Note string
				}
				json.Unmarshal(raw, &e)
				return []any{cid, e.Time, e.Note}
			}},
	}

	for _, imp := range imports {
		entries := bbFetchAll(client, req.URL, req.Token, imp.endpoint)
		count := 0
		for _, raw := range entries {
			var base struct {
				Child int `json:"child"`
			}
			json.Unmarshal(raw, &base)
			localID, ok := childMap[base.Child]
			if !ok {
				continue
			}
			args := imp.extract(raw, localID)
			if _, err := h.db.Exec(database.Q(h.db, imp.sql), args...); err == nil {
				count++
			}
		}
		stats[imp.name] = count
	}

	slog.Info("baby buddy import completed", "stats", stats)
	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"status": "completed",
		"stats":  stats,
	})
}

func bbFetchAll(client *http.Client, baseURL, token, endpoint string) []json.RawMessage {
	var all []json.RawMessage
	url := baseURL + endpoint + "?limit=100&offset=0"

	for url != "" {
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			break
		}
		req.Header.Set("Authorization", "Token "+token)

		resp, err := client.Do(req)
		if err != nil {
			slog.Warn("bb import: request failed", "url", url, "error", err)
			break
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode != 200 {
			slog.Warn("bb import: non-200 response", "url", url, "status", resp.StatusCode)
			break
		}

		var page bbPage
		if json.Unmarshal(body, &page) != nil {
			break
		}

		var results []json.RawMessage
		json.Unmarshal(page.Results, &results)
		all = append(all, results...)

		if page.Next != nil {
			url = *page.Next
		} else {
			url = ""
		}
	}

	return all
}

// validateBBURL checks that a Baby Buddy URL is a safe external HTTP(S) address.
// Rejects internal/private IPs to prevent SSRF attacks.
func validateBBURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL")
	}

	// Only allow http and https
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("URL must use http or https")
	}

	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("URL must include a hostname")
	}

	// Resolve hostname to check for private IPs
	ips, err := net.LookupHost(host)
	if err != nil {
		return fmt.Errorf("cannot resolve hostname")
	}

	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return fmt.Errorf("URL must not point to a loopback or link-local address")
		}
		// Check cloud metadata addresses
		if ipStr == "169.254.169.254" {
			return fmt.Errorf("URL must not point to cloud metadata service")
		}
	}

	// Block common internal hostnames
	lower := strings.ToLower(host)
	if lower == "localhost" || lower == "metadata.google.internal" {
		return fmt.Errorf("URL must not point to an internal service")
	}

	return nil
}
