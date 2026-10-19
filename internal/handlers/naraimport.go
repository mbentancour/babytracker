package handlers

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// Nara Baby has no published export spec. The column layout below comes from
// real exports seen in other open-source importers: one CSV per child, a
// `Type` column per row, epoch-millisecond timestamps, and type-specific
// fields in columns prefixed with the type name, e.g.
// `[Bottle Feed] Formula Volume` + `[Bottle Feed] Formula Volume Unit`.
// Rows we can't map are counted as skipped or rejected (with a reason) rather
// than guessed at, so an unexpected layout shows up in the import summary
// instead of as wrong data.

type NaraImportHandler struct {
	db  *sqlx.DB
	cfg *config.Config
}

func NewNaraImportHandler(db *sqlx.DB, cfg *config.Config) *NaraImportHandler {
	return &NaraImportHandler{db: db, cfg: cfg}
}

// naraRejection reports a row that looked importable but couldn't be mapped.
type naraRejection struct {
	Line   int    `json:"line"`
	Type   string `json:"type"`
	Reason string `json:"reason"`
}

type naraFeeding struct {
	Start, End   time.Time
	Type, Method string
	Amount       *float64
	Notes        string
}

type naraSleep struct {
	Start, End time.Time
	Notes      string
}

type naraChange struct {
	Time       time.Time
	Wet, Solid bool
	Color      string
	Notes      string
}

type naraPumping struct {
	Start, End time.Time
	Amount     *float64
}

type naraMeasurement struct {
	Date  string // YYYY-MM-DD in the importer's timezone
	Value float64
	Notes string
}

type naraNote struct {
	Time time.Time
	Note string
}

// naraPlan is everything parsed out of one export, ready to insert.
type naraPlan struct {
	Feedings []naraFeeding
	Sleep    []naraSleep
	Changes  []naraChange
	Pumping  []naraPumping
	Weight   []naraMeasurement
	Height   []naraMeasurement
	HeadCirc []naraMeasurement
	Notes    []naraNote
	Skipped  map[string]int
	Rejected []naraRejection
}

type naraOptions struct {
	UnitSystem string         // "metric" or "imperial" — values are stored in the instance's display units
	Location   *time.Location // for turning timestamps into calendar dates (growth entries)
}

var errNotNaraExport = errors.New("this file doesn't look like a Nara Baby export (no Type column)")

// Import creates a child from the submitted name/birth date and imports a
// Nara Baby CSV export into it, all in one transaction.
// POST /api/import/nara (multipart: file, first_name, last_name, birth_date, timezone)
func (h *NaraImportHandler) Import(w http.ResponseWriter, r *http.Request) {
	if isAdmin, ok := r.Context().Value(middleware.IsAdminKey).(bool); !ok || !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 50<<20) // exports are a few MB at most
	if err := r.ParseMultipartForm(50 << 20); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "invalid upload")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "export file required")
		return
	}
	defer file.Close()

	firstName := strings.TrimSpace(r.FormValue("first_name"))
	lastName := strings.TrimSpace(r.FormValue("last_name"))
	birthDate := r.FormValue("birth_date")
	if firstName == "" {
		pagination.WriteError(w, http.StatusBadRequest, "first name is required")
		return
	}
	if _, err := time.Parse("2006-01-02", birthDate); err != nil {
		pagination.WriteError(w, http.StatusBadRequest, "birth date must be YYYY-MM-DD")
		return
	}
	loc := time.UTC
	if tz := r.FormValue("timezone"); tz != "" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	}

	plan, err := parseNaraExport(file, naraOptions{UnitSystem: h.cfg.UnitSystem, Location: loc})
	if err != nil {
		pagination.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	childID, stats, err := insertNaraPlan(h.db, firstName, lastName, birthDate, plan)
	if err != nil {
		slog.Error("nara import failed", "error", err)
		pagination.WriteError(w, http.StatusInternalServerError, "import failed")
		return
	}

	rejected := plan.Rejected
	if len(rejected) > 50 {
		rejected = rejected[:50]
	}
	slog.Info("nara import completed", "stats", stats, "skipped", plan.Skipped, "rejected", len(plan.Rejected))
	pagination.WriteJSON(w, http.StatusOK, map[string]any{
		"status":         "completed",
		"child_id":       childID,
		"stats":          stats,
		"skipped":        plan.Skipped,
		"rejected":       rejected,
		"rejected_count": len(plan.Rejected),
	})
}

func insertNaraPlan(db *sqlx.DB, firstName, lastName, birthDate string, p *naraPlan) (int, map[string]int, error) {
	tx, err := db.Beginx()
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback()

	var childID int
	if err := tx.QueryRow(
		`INSERT INTO children (first_name, last_name, birth_date) VALUES ($1, $2, $3) RETURNING id`,
		firstName, lastName, birthDate,
	).Scan(&childID); err != nil {
		return 0, nil, fmt.Errorf("insert child: %w", err)
	}

	exec := func(query string, args ...any) error {
		_, err := tx.Exec(query, args...)
		return err
	}
	for _, f := range p.Feedings {
		if err := exec(`INSERT INTO feedings (child_id, start_time, end_time, type, method, amount, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			childID, f.Start, f.End, f.Type, f.Method, f.Amount, f.Notes); err != nil {
			return 0, nil, fmt.Errorf("insert feeding: %w", err)
		}
	}
	for _, s := range p.Sleep {
		if err := exec(`INSERT INTO sleep (child_id, start_time, end_time, notes) VALUES ($1,$2,$3,$4)`,
			childID, s.Start, s.End, s.Notes); err != nil {
			return 0, nil, fmt.Errorf("insert sleep: %w", err)
		}
	}
	for _, c := range p.Changes {
		if err := exec(`INSERT INTO changes (child_id, time, wet, solid, color, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
			childID, c.Time, c.Wet, c.Solid, c.Color, c.Notes); err != nil {
			return 0, nil, fmt.Errorf("insert change: %w", err)
		}
	}
	for _, pm := range p.Pumping {
		if err := exec(`INSERT INTO pumping (child_id, start_time, end_time, amount) VALUES ($1,$2,$3,$4)`,
			childID, pm.Start, pm.End, pm.Amount); err != nil {
			return 0, nil, fmt.Errorf("insert pumping: %w", err)
		}
	}
	for _, m := range p.Weight {
		if err := exec(`INSERT INTO weight (child_id, date, weight, notes) VALUES ($1,$2,$3,$4)`,
			childID, m.Date, m.Value, m.Notes); err != nil {
			return 0, nil, fmt.Errorf("insert weight: %w", err)
		}
	}
	for _, m := range p.Height {
		if err := exec(`INSERT INTO height (child_id, date, height, notes) VALUES ($1,$2,$3,$4)`,
			childID, m.Date, m.Value, m.Notes); err != nil {
			return 0, nil, fmt.Errorf("insert height: %w", err)
		}
	}
	for _, m := range p.HeadCirc {
		if err := exec(`INSERT INTO head_circumference (child_id, date, head_circumference, notes) VALUES ($1,$2,$3,$4)`,
			childID, m.Date, m.Value, m.Notes); err != nil {
			return 0, nil, fmt.Errorf("insert head circumference: %w", err)
		}
	}
	for _, n := range p.Notes {
		if err := exec(`INSERT INTO notes (child_id, time, note) VALUES ($1,$2,$3)`,
			childID, n.Time, n.Note); err != nil {
			return 0, nil, fmt.Errorf("insert note: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, nil, err
	}
	stats := map[string]int{
		"feedings":           len(p.Feedings),
		"sleep":              len(p.Sleep),
		"changes":            len(p.Changes),
		"pumping":            len(p.Pumping),
		"weight":             len(p.Weight),
		"height":             len(p.Height),
		"head-circumference": len(p.HeadCirc),
		"notes":              len(p.Notes),
	}
	return childID, stats, nil
}

// naraRow gives column access by header name for one CSV record.
type naraRow struct {
	cols   map[string]int
	record []string
}

func (r naraRow) get(col string) string {
	i, ok := r.cols[col]
	if !ok || i >= len(r.record) {
		return ""
	}
	return strings.TrimSpace(r.record[i])
}

func parseNaraExport(src io.Reader, opts naraOptions) (*naraPlan, error) {
	if opts.Location == nil {
		opts.Location = time.UTC
	}
	cr := csv.NewReader(src)
	cr.FieldsPerRecord = -1 // the trailing Profile row is one field short
	cr.LazyQuotes = true

	header, err := cr.Read()
	if err != nil {
		return nil, errNotNaraExport
	}
	cols := make(map[string]int, len(header))
	for i, h := range header {
		if i == 0 {
			h = strings.TrimPrefix(h, "\uFEFF")
		}
		cols[strings.TrimSpace(h)] = i
	}
	if _, ok := cols["Type"]; !ok {
		return nil, errNotNaraExport
	}

	p := &naraPlan{Skipped: map[string]int{}}
	line := 1
	for {
		record, err := cr.Read()
		if err == io.EOF {
			break
		}
		line++
		if err != nil {
			return nil, fmt.Errorf("could not read the CSV near line %d: %v", line, err)
		}
		row := naraRow{cols: cols, record: record}
		typ := row.get("Type")
		if typ == "" || typ == "Profile" { // Profile is export metadata, not an entry
			continue
		}
		if err := p.addRow(row, typ, opts); err != nil {
			if errors.Is(err, errNaraUnsupported) {
				p.Skipped[typ]++
				continue
			}
			p.Rejected = append(p.Rejected, naraRejection{Line: line, Type: typ, Reason: err.Error()})
		}
	}
	return p, nil
}

var errNaraUnsupported = errors.New("unsupported row type")

func (p *naraPlan) addRow(row naraRow, typ string, opts naraOptions) error {
	switch typ {
	case "Breastfeed", "Bottle Feed", "Combo Feed", "Diaper", "Pump", "Growth", "Sleep":
	default:
		return errNaraUnsupported
	}

	start, err := naraEpoch(row.get("Start Date/time (Epoch)"))
	if err != nil {
		return fmt.Errorf("start time: %w", err)
	}
	note := row.get("Note")

	switch typ {
	case "Breastfeed":
		f, err := naraBreastfeed(row, "Breastfeed", start)
		if err != nil {
			return err
		}
		f.Notes = note
		p.Feedings = append(p.Feedings, f)

	case "Bottle Feed":
		f, err := naraBottle(row, "Bottle Feed", start, opts)
		if err != nil {
			return err
		}
		f.Notes = joinNotes(f.Notes, note)
		p.Feedings = append(p.Feedings, f)

	case "Combo Feed":
		// One Nara entry covering a breastfeed and a top-up bottle becomes two
		// feedings here, since a feeding has a single method.
		breast, err := naraBreastfeed(row, "Combo Feed", start)
		if err != nil {
			return err
		}
		bottle, err := naraBottle(row, "Combo Feed", start, opts)
		if err != nil {
			return err
		}
		bottle.Notes = joinNotes(bottle.Notes, note)
		// Skip the breast half when Nara recorded neither a duration nor a side.
		if breast.End.After(start) || naraSide(row.get("[Combo Feed] Begin Side")) != "" {
			breast.Notes = note
			p.Feedings = append(p.Feedings, breast)
		}
		p.Feedings = append(p.Feedings, bottle)

	case "Diaper":
		c, err := naraDiaper(row, start)
		if err != nil {
			return err
		}
		c.Notes = joinNotes(c.Notes, note)
		p.Changes = append(p.Changes, c)

	case "Pump":
		pm, err := naraPump(row, start, opts)
		if err != nil {
			return err
		}
		p.Pumping = append(p.Pumping, pm)
		// Pumping entries have no notes field; keep the text as a note.
		if note != "" {
			p.Notes = append(p.Notes, naraNote{Time: start, Note: "Pumping: " + note})
		}

	case "Growth":
		return p.addGrowth(row, start, note, opts)

	case "Sleep":
		// No sample export with sleep rows has been seen. This assumes the same
		// layout as Pump (end epoch, or a duration); if Nara uses something
		// else these rows are rejected with this reason, not guessed at.
		end, err := naraEnd(row, "Sleep", start)
		if err != nil {
			return err
		}
		if end.Equal(start) {
			return errors.New("no end time or duration found")
		}
		p.Sleep = append(p.Sleep, naraSleep{Start: start, End: end, Notes: note})
	}
	return nil
}

func naraBreastfeed(row naraRow, prefix string, start time.Time) (naraFeeding, error) {
	left, err := naraOptionalNumber(row.get("[" + prefix + "] Left Duration (Seconds)"))
	if err != nil {
		return naraFeeding{}, fmt.Errorf("left duration: %w", err)
	}
	right, err := naraOptionalNumber(row.get("[" + prefix + "] Right Duration (Seconds)"))
	if err != nil {
		return naraFeeding{}, fmt.Errorf("right duration: %w", err)
	}
	var l, r float64
	if left != nil {
		l = *left
	}
	if right != nil {
		r = *right
	}

	var method string
	switch {
	case l > 0 && r > 0:
		method = "both breasts"
	case l > 0:
		method = "left breast"
	case r > 0:
		method = "right breast"
	default:
		// No timed sides: fall back to the recorded side, if any.
		switch naraSide(row.get("[" + prefix + "] Begin Side")) {
		case "left":
			method = "left breast"
		case "right":
			method = "right breast"
		default:
			method = "both breasts"
		}
	}
	end := start.Add(time.Duration(math.Round(l+r)) * time.Second)
	return naraFeeding{Start: start, End: end, Type: "breast milk", Method: method}, nil
}

// naraSide normalizes "LEFT" / "RIGHT.nonTimer" style values to left/right.
func naraSide(v string) string {
	v = strings.ToLower(strings.TrimSuffix(v, ".nonTimer"))
	if v == "left" || v == "right" {
		return v
	}
	return ""
}

func naraBottle(row naraRow, prefix string, start time.Time, opts naraOptions) (naraFeeding, error) {
	col := func(name string) string { return "[" + prefix + "] " + name }
	kind := row.get(col("Type"))
	hasBM := strings.Contains(kind, "Breast Milk")
	hasFormula := strings.Contains(kind, "Formula")

	bm, err := naraVolume(row, col("Breast Milk Volume"), opts)
	if err != nil {
		return naraFeeding{}, err
	}
	formula, err := naraVolume(row, col("Formula Volume"), opts)
	if err != nil {
		return naraFeeding{}, err
	}
	total, err := naraVolume(row, col("Volume"), opts)
	if err != nil {
		return naraFeeding{}, err
	}

	f := naraFeeding{Start: start, End: start, Type: "breast milk", Method: "bottle"}
	var notes []string
	switch {
	case bm != nil || formula != nil:
		var b, fo float64
		if bm != nil {
			b = *bm
		}
		if formula != nil {
			fo = *formula
		}
		sum := roundTo(b+fo, 2)
		f.Amount = &sum
		if fo > b {
			f.Type = "formula"
		}
		if b > 0 && fo > 0 {
			// A feeding has one type; keep the split so nothing is lost.
			unit := volumeUnit(opts.UnitSystem)
			notes = append(notes, fmt.Sprintf("Mixed bottle: %s %s breast milk + %s %s formula",
				formatAmount(b), unit, formatAmount(fo), unit))
		}
	case total != nil:
		f.Amount = total
		if hasFormula && !hasBM {
			f.Type = "formula"
		}
		if hasFormula && hasBM {
			notes = append(notes, "Mixed bottle (breast milk + formula), no split recorded")
		}
	default:
		if hasFormula && !hasBM {
			f.Type = "formula"
		}
	}
	if brand := row.get(col("Formula Name")); brand != "" {
		notes = append(notes, "Formula: "+brand)
	}
	f.Notes = strings.Join(notes, "; ")
	return f, nil
}

// changes.color only accepts these; anything else goes into the notes.
var naraChangeColors = map[string]bool{"black": true, "brown": true, "green": true, "yellow": true}

var naraTextures = map[string]string{
	"RUN": "runny", "MUCOUS": "mucousy", "MUSH": "mushy", "SOLID": "solid", "PEBBLE": "pebbles",
}

func naraDiaper(row naraRow, at time.Time) (naraChange, error) {
	kind := row.get("[Diaper] Type")
	wet := strings.Contains(kind, "Wet")
	dirty := strings.Contains(kind, "Dirty")
	if !wet && !dirty && !strings.Contains(kind, "Dry") {
		return naraChange{}, fmt.Errorf("unrecognized diaper type %q", kind)
	}
	c := naraChange{Time: at, Wet: wet, Solid: dirty}

	var notes, otherColors, textures []string
	for _, tok := range strings.Fields(row.get("[Diaper] Dirty Color")) {
		color := strings.ToLower(tok)
		if c.Color == "" && naraChangeColors[color] {
			c.Color = color
		} else {
			otherColors = append(otherColors, color)
		}
	}
	for _, tok := range strings.Fields(row.get("[Diaper] Dirty Texture")) {
		if t, ok := naraTextures[strings.ToUpper(tok)]; ok {
			textures = append(textures, t)
		} else {
			textures = append(textures, strings.ToLower(tok))
		}
	}
	if len(textures) > 0 {
		notes = append(notes, "Texture: "+strings.Join(textures, ", "))
	}
	if len(otherColors) > 0 {
		label := "Color: "
		if c.Color != "" {
			label = "Also: "
		}
		notes = append(notes, label+strings.Join(otherColors, ", "))
	}
	detail := row.get("[Diaper] Detail")
	if strings.Contains(detail, "Blowout") {
		notes = append(notes, "Blowout")
	}
	if strings.Contains(detail, "Rash") {
		notes = append(notes, "Rash")
	}
	c.Notes = strings.Join(notes, "; ")
	return c, nil
}

func naraPump(row naraRow, start time.Time, opts naraOptions) (naraPumping, error) {
	left, err := naraVolume(row, "[Pump] Left Volume", opts)
	if err != nil {
		return naraPumping{}, err
	}
	right, err := naraVolume(row, "[Pump] Right Volume", opts)
	if err != nil {
		return naraPumping{}, err
	}
	total, err := naraVolume(row, "[Pump] Volume", opts)
	if err != nil {
		return naraPumping{}, err
	}
	end, err := naraEnd(row, "Pump", start)
	if err != nil {
		return naraPumping{}, err
	}
	pm := naraPumping{Start: start, End: end}
	if left != nil || right != nil {
		var sum float64
		if left != nil {
			sum += *left
		}
		if right != nil {
			sum += *right
		}
		sum = roundTo(sum, 2)
		pm.Amount = &sum
	} else {
		pm.Amount = total
	}
	return pm, nil
}

// naraEnd reads `[T] End Date/time (Epoch)`, falling back to
// `[T] Duration (Seconds)`, then to the start time.
func naraEnd(row naraRow, prefix string, start time.Time) (time.Time, error) {
	if v := row.get("[" + prefix + "] End Date/time (Epoch)"); v != "" {
		end, err := naraEpoch(v)
		if err != nil {
			return time.Time{}, fmt.Errorf("end time: %w", err)
		}
		if end.Before(start) {
			return time.Time{}, errors.New("end time is before start time")
		}
		return end, nil
	}
	secs, err := naraOptionalNumber(row.get("[" + prefix + "] Duration (Seconds)"))
	if err != nil {
		return time.Time{}, fmt.Errorf("duration: %w", err)
	}
	if secs != nil && *secs > 0 {
		return start.Add(time.Duration(math.Round(*secs)) * time.Second), nil
	}
	return start, nil
}

func (p *naraPlan) addGrowth(row naraRow, at time.Time, note string, opts naraOptions) error {
	date := at.In(opts.Location).Format("2006-01-02")
	imperial := opts.UnitSystem == "imperial"

	weight, err := naraOptionalNumber(row.get("[Growth] Weight"))
	if err != nil {
		return fmt.Errorf("weight: %w", err)
	}
	height, err := naraOptionalNumber(row.get("[Growth] Height"))
	if err != nil {
		return fmt.Errorf("height: %w", err)
	}
	head, err := naraOptionalNumber(row.get("[Growth] Head Size"))
	if err != nil {
		return fmt.Errorf("head size: %w", err)
	}
	if weight == nil && height == nil && head == nil {
		return errors.New("no weight, height, or head size")
	}

	// Validate every unit before appending anything, so a bad row adds nothing.
	var w, h, hd float64
	if weight != nil {
		kg, err := naraToKg(*weight, row.get("[Growth] Weight Unit"))
		if err != nil {
			return err
		}
		w = roundTo(kg, 3)
		if imperial {
			w = roundTo(kg/0.45359237, 2)
		}
	}
	if height != nil {
		cm, err := naraToCm(*height, row.get("[Growth] Height Unit"))
		if err != nil {
			return err
		}
		h = roundTo(cm, 1)
		if imperial {
			h = roundTo(cm/2.54, 2)
		}
	}
	if head != nil {
		cm, err := naraToCm(*head, row.get("[Growth] Head Size Unit"))
		if err != nil {
			return err
		}
		hd = roundTo(cm, 1)
		if imperial {
			hd = roundTo(cm/2.54, 2)
		}
	}
	if weight != nil {
		p.Weight = append(p.Weight, naraMeasurement{Date: date, Value: w, Notes: note})
	}
	if height != nil {
		p.Height = append(p.Height, naraMeasurement{Date: date, Value: h, Notes: note})
	}
	if head != nil {
		p.HeadCirc = append(p.HeadCirc, naraMeasurement{Date: date, Value: hd, Notes: note})
	}
	return nil
}

// naraVolume reads a volume column and its "<col> Unit" companion, converting
// to the instance's volume unit (mL for metric, fl oz for imperial).
func naraVolume(row naraRow, col string, opts naraOptions) (*float64, error) {
	v, err := naraOptionalNumber(row.get(col))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", col, err)
	}
	if v == nil {
		return nil, nil
	}
	var ml float64
	switch unit := strings.ToUpper(strings.ReplaceAll(row.get(col+" Unit"), " ", "")); unit {
	case "ML":
		ml = *v
	case "OZ", "FLOZ":
		ml = *v * 29.5735295625
	case "":
		// Silently assuming mL could store oz values 30x too small; report it.
		return nil, fmt.Errorf("%s has no unit", col)
	default:
		return nil, fmt.Errorf("%s has unknown unit %q", col, unit)
	}
	out := roundTo(ml, 1)
	if opts.UnitSystem == "imperial" {
		out = roundTo(ml/29.5735295625, 2)
	}
	return &out, nil
}

func naraToKg(v float64, unit string) (float64, error) {
	switch strings.ToUpper(unit) {
	case "KG":
		return v, nil
	case "G":
		return v / 1000, nil
	case "LB", "LBS":
		return v * 0.45359237, nil
	case "OZ":
		return v * 0.028349523125, nil
	case "":
		return 0, errors.New("weight has no unit")
	}
	return 0, fmt.Errorf("weight has unknown unit %q", unit)
}

func naraToCm(v float64, unit string) (float64, error) {
	switch strings.ToUpper(unit) {
	case "CM":
		return v, nil
	case "MM":
		return v / 10, nil
	case "IN":
		return v * 2.54, nil
	case "":
		return 0, errors.New("length has no unit")
	}
	return 0, fmt.Errorf("length has unknown unit %q", unit)
}

// naraEpoch parses an epoch timestamp. Nara exports milliseconds; a value
// small enough to be seconds is accepted too.
func naraEpoch(v string) (time.Time, error) {
	if v == "" {
		return time.Time{}, errors.New("missing")
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		f, ferr := strconv.ParseFloat(v, 64)
		if ferr != nil {
			return time.Time{}, fmt.Errorf("%q is not a timestamp", v)
		}
		n = int64(f)
	}
	if n < 100_000_000_000 {
		return time.Unix(n, 0).UTC(), nil
	}
	return time.UnixMilli(n).UTC(), nil
}

func naraOptionalNumber(v string) (*float64, error) {
	if v == "" {
		return nil, nil
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
		return nil, fmt.Errorf("%q is not a valid number", v)
	}
	return &n, nil
}

func volumeUnit(system string) string {
	if system == "imperial" {
		return "oz"
	}
	return "mL"
}

func roundTo(v float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(v*p) / p
}

func formatAmount(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

func joinNotes(parts ...string) string {
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, "; ")
}
