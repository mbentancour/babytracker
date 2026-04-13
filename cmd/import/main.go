package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/database"
)

var (
	bbURL      = flag.String("url", "", "Baby Buddy URL (e.g. http://localhost:8000)")
	bbToken    = flag.String("token", "", "Baby Buddy API token")
	dbURL      = flag.String("database-url", "postgres://babytracker:babytracker@localhost:5432/babytracker?sslmode=disable", "PostgreSQL connection URL")
)

type bbPaginatedResponse struct {
	Count   int             `json:"count"`
	Next    *string         `json:"next"`
	Results json.RawMessage `json:"results"`
}

func main() {
	flag.Parse()

	if *bbURL == "" || *bbToken == "" {
		fmt.Println("Usage: babytracker-import --url <baby-buddy-url> --token <api-token> [--database-url <pg-url>]")
		fmt.Println()
		fmt.Println("Imports all data from a Baby Buddy instance into BabyTracker.")
		fmt.Println()
		fmt.Println("Example:")
		fmt.Println("  babytracker-import --url http://192.168.1.100:8000 --token abc123def456")
		os.Exit(1)
	}

	db, err := database.Connect(*dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	client := &http.Client{Timeout: 30 * time.Second}

	fmt.Println("=== BabyTracker Import from Baby Buddy ===")
	fmt.Printf("Source: %s\n", *bbURL)
	fmt.Println()

	// Import children first
	fmt.Print("Importing children... ")
	childMap := map[int]int{} // BB ID -> local ID
	children := fetchAll(client, "/api/children/")
	for _, raw := range children {
		var c struct {
			ID        int    `json:"id"`
			FirstName string `json:"first_name"`
			LastName  string `json:"last_name"`
			BirthDate string `json:"birth_date"`
		}
		json.Unmarshal(raw, &c)
		var localID int
		err := db.QueryRow(
			`INSERT INTO children (first_name, last_name, birth_date) VALUES ($1, $2, $3) RETURNING id`,
			c.FirstName, c.LastName, c.BirthDate,
		).Scan(&localID)
		if err != nil {
			log.Printf("  Warning: failed to import child %s: %v", c.FirstName, err)
			continue
		}
		childMap[c.ID] = localID
	}
	fmt.Printf("%d imported\n", len(childMap))

	// Import each entity type
	importTimedEntries(db, client, childMap, "feedings", "/api/feedings/",
		`INSERT INTO feedings (child_id, start_time, end_time, type, method, amount, duration, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		func(raw json.RawMessage, childID int) []any {
			var e struct {
				Start    string   `json:"start"`
				End      string   `json:"end"`
				Type     string   `json:"type"`
				Method   string   `json:"method"`
				Amount   *float64 `json:"amount"`
				Duration *string  `json:"duration"`
				Notes    string   `json:"notes"`
			}
			json.Unmarshal(raw, &e)
			return []any{childID, e.Start, e.End, e.Type, e.Method, e.Amount, e.Duration, e.Notes}
		})

	importTimedEntries(db, client, childMap, "sleep", "/api/sleep/",
		`INSERT INTO sleep (child_id, start_time, end_time, duration, nap, notes) VALUES ($1, $2, $3, $4, $5, $6)`,
		func(raw json.RawMessage, childID int) []any {
			var e struct {
				Start    string  `json:"start"`
				End      string  `json:"end"`
				Duration *string `json:"duration"`
				Nap      bool    `json:"nap"`
				Notes    string  `json:"notes"`
			}
			json.Unmarshal(raw, &e)
			return []any{childID, e.Start, e.End, e.Duration, e.Nap, e.Notes}
		})

	importTimedEntries(db, client, childMap, "changes", "/api/changes/",
		`INSERT INTO changes (child_id, time, wet, solid, color, notes) VALUES ($1, $2, $3, $4, $5, $6)`,
		func(raw json.RawMessage, childID int) []any {
			var e struct {
				Time  string `json:"time"`
				Wet   bool   `json:"wet"`
				Solid bool   `json:"solid"`
				Color string `json:"color"`
				Notes string `json:"notes"`
			}
			json.Unmarshal(raw, &e)
			return []any{childID, e.Time, e.Wet, e.Solid, e.Color, e.Notes}
		})

	importTimedEntries(db, client, childMap, "tummy-times", "/api/tummy-times/",
		`INSERT INTO tummy_times (child_id, start_time, end_time, duration, milestone, notes) VALUES ($1, $2, $3, $4, $5, $6)`,
		func(raw json.RawMessage, childID int) []any {
			var e struct {
				Start     string  `json:"start"`
				End       string  `json:"end"`
				Duration  *string `json:"duration"`
				Milestone string  `json:"milestone"`
				Notes     string  `json:"notes"`
			}
			json.Unmarshal(raw, &e)
			return []any{childID, e.Start, e.End, e.Duration, e.Milestone, e.Notes}
		})

	importTimedEntries(db, client, childMap, "temperature", "/api/temperature/",
		`INSERT INTO temperature (child_id, time, temperature, notes) VALUES ($1, $2, $3, $4)`,
		func(raw json.RawMessage, childID int) []any {
			var e struct {
				Time        string  `json:"time"`
				Temperature float64 `json:"temperature"`
				Notes       string  `json:"notes"`
			}
			json.Unmarshal(raw, &e)
			return []any{childID, e.Time, e.Temperature, e.Notes}
		})

	importTimedEntries(db, client, childMap, "weight", "/api/weight/",
		`INSERT INTO weight (child_id, date, weight, notes) VALUES ($1, $2, $3, $4)`,
		func(raw json.RawMessage, childID int) []any {
			var e struct {
				Date   string  `json:"date"`
				Weight float64 `json:"weight"`
				Notes  string  `json:"notes"`
			}
			json.Unmarshal(raw, &e)
			return []any{childID, e.Date, e.Weight, e.Notes}
		})

	importTimedEntries(db, client, childMap, "height", "/api/height/",
		`INSERT INTO height (child_id, date, height, notes) VALUES ($1, $2, $3, $4)`,
		func(raw json.RawMessage, childID int) []any {
			var e struct {
				Date   string  `json:"date"`
				Height float64 `json:"height"`
				Notes  string  `json:"notes"`
			}
			json.Unmarshal(raw, &e)
			return []any{childID, e.Date, e.Height, e.Notes}
		})

	importTimedEntries(db, client, childMap, "head-circumference", "/api/head-circumference/",
		`INSERT INTO head_circumference (child_id, date, head_circumference, notes) VALUES ($1, $2, $3, $4)`,
		func(raw json.RawMessage, childID int) []any {
			var e struct {
				Date              string  `json:"date"`
				HeadCircumference float64 `json:"head_circumference"`
				Notes             string  `json:"notes"`
			}
			json.Unmarshal(raw, &e)
			return []any{childID, e.Date, e.HeadCircumference, e.Notes}
		})

	importTimedEntries(db, client, childMap, "pumping", "/api/pumping/",
		`INSERT INTO pumping (child_id, start_time, end_time, amount, duration) VALUES ($1, $2, $3, $4, $5)`,
		func(raw json.RawMessage, childID int) []any {
			var e struct {
				Start    string   `json:"start"`
				End      string   `json:"end"`
				Amount   *float64 `json:"amount"`
				Duration *string  `json:"duration"`
			}
			json.Unmarshal(raw, &e)
			return []any{childID, e.Start, e.End, e.Amount, e.Duration}
		})

	importTimedEntries(db, client, childMap, "notes", "/api/notes/",
		`INSERT INTO notes (child_id, time, note) VALUES ($1, $2, $3)`,
		func(raw json.RawMessage, childID int) []any {
			var e struct {
				Time string `json:"time"`
				Note string `json:"note"`
			}
			json.Unmarshal(raw, &e)
			return []any{childID, e.Time, e.Note}
		})

	fmt.Println()
	fmt.Println("=== Import complete ===")
}

func importTimedEntries(db *sqlx.DB, client *http.Client, childMap map[int]int, name, endpoint, insertSQL string, extract func(json.RawMessage, int) []any) {
	fmt.Printf("Importing %s... ", name)
	entries := fetchAll(client, endpoint)
	count := 0
	for _, raw := range entries {
		var base struct {
			Child int `json:"child"`
		}
		json.Unmarshal(raw, &base)
		localChildID, ok := childMap[base.Child]
		if !ok {
			continue
		}
		args := extract(raw, localChildID)
		if _, err := db.Exec(insertSQL, args...); err != nil {
			continue
		}
		count++
	}
	fmt.Printf("%d imported\n", count)
}

func fetchAll(client *http.Client, endpoint string) []json.RawMessage {
	var all []json.RawMessage
	url := *bbURL + endpoint + "?limit=100&offset=0"

	for url != "" {
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			log.Printf("  Warning: failed to create request: %v", err)
			break
		}
		req.Header.Set("Authorization", "Token "+*bbToken)

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("  Warning: request failed: %v", err)
			break
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode != 200 {
			log.Printf("  Warning: %s returned %d", url, resp.StatusCode)
			break
		}

		var page bbPaginatedResponse
		if err := json.Unmarshal(body, &page); err != nil {
			log.Printf("  Warning: failed to parse response: %v", err)
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
