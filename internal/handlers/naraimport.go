package handlers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // per-row zones and browser zones must resolve on hosts without full tzdata
	"unicode/utf8"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/middleware"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// Nara Baby publishes no export spec. The columns and values below follow
// the schema in jarnskeggi/BabyWise (NaraSchema.kt, MIT) and the sample
// exports published with other open-source importers: one CSV per child, a
// `Type` column per row, epoch-millisecond timestamps with an IANA
// `Time Zone` per row, and type-specific fields in columns prefixed with the
// type name, e.g. `[Bottle Feed] Formula Volume` + `... Unit`.
//
// Rows whose values can't be read are rejected with a reason code. Rows
// imported with an assumption (a bottle with no milk type, a breastfeed with
// no side) are listed as warnings. Both are reported on the import summary,
// with the CSV line, so the user can check them in Nara.

type NaraImportHandler struct {
	db  *sqlx.DB
	cfg *config.Config
	now func() time.Time
}

func NewNaraImportHandler(db *sqlx.DB, cfg *config.Config) *NaraImportHandler {
	return &NaraImportHandler{db: db, cfg: cfg, now: time.Now}
}

const (
	naraMaxUpload = 50 << 20
	naraIssueCap  = 50 // issues returned per list; the full counts are returned too

	naraMaxDuration = 24 * time.Hour
	naraMaxVolumeML = 1000.0
	naraMaxWeightKg = 50.0
	naraMaxHeightCm = 200.0
	naraMaxHeadCm   = 100.0
	naraMinTempC    = 30.0 // the temperature form's range (30–45 °C, 86–113 °F)
	naraMaxTempC    = 45.0
	mlPerFlOz       = 29.5735295625
	kgPerLb         = 0.45359237
	cmPerIn         = 2.54
)

// naraEarliest bounds plausible timestamps from below; the upper bound is the
// request time plus a little slack for clock skew.
var naraEarliest = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)

// naraIssue is a row that was rejected or imported with an assumption. Code,
// Detail (usually the Nara column) and Value (the value read) let the UI show
// a translated reason; Reason is the English text.
type naraIssue struct {
	Line   int    `json:"line"`
	Type   string `json:"type"`
	Code   string `json:"code"`
	Detail string `json:"detail,omitempty"`
	Value  string `json:"value,omitempty"`
	Reason string `json:"reason"`
}

// naraRowError rejects one row.
type naraRowError struct {
	Code, Detail, Value, Reason string
}

func (e *naraRowError) Error() string { return e.Reason }

func rowErr(code, detail, format string, args ...any) error {
	return &naraRowError{Code: code, Detail: detail, Reason: fmt.Sprintf(format, args...)}
}

func rowErrValue(code, detail, value, format string, args ...any) error {
	return &naraRowError{Code: code, Detail: detail, Value: value, Reason: fmt.Sprintf(format, args...)}
}

// errNaraNothingToImport is returned by insertNaraPlan when nothing is left
// to insert, so no empty child is created.
var errNaraNothingToImport = errors.New("nothing to import")

// naraFileError rejects the whole upload.
type naraFileError struct {
	Status  int
	Code    string
	Detail  string
	Message string
}

func (e *naraFileError) Error() string { return e.Message }

var errNotNaraExport = &naraFileError{
	Status: http.StatusBadRequest, Code: "not_nara_export",
	Message: "this file doesn't look like a Nara Baby export",
}

// errNaraSpreadsheet is returned for an epoch a spreadsheet app has
// rewritten in scientific notation (1.78998E+12), which loses up to ±83
// minutes. Every row in such a file is affected, so the file is refused.
var errNaraSpreadsheet = &naraFileError{
	Status: http.StatusBadRequest, Code: "spreadsheet_rounded",
	Message: "the timestamps in this file were rounded by a spreadsheet app; export again from Nara and upload that file without opening it in a spreadsheet",
}

func writeNaraError(w http.ResponseWriter, status int, code, detail, message string) {
	body := map[string]string{"error": message, "code": code}
	if detail != "" {
		body["detail"] = detail
	}
	pagination.WriteJSON(w, status, body)
}

// Preview parses an export without saving anything and reports what an
// import would bring over, plus the baby's details from the profile row.
// POST /api/import/nara/preview (multipart: file, unit_system, timezone)
func (h *NaraImportHandler) Preview(w http.ResponseWriter, r *http.Request) {
	plan, opts, ok := h.readUpload(w, r)
	if !ok {
		return
	}
	defer r.MultipartForm.RemoveAll()
	if err := markDuplicatePumps(h.db, plan); err != nil {
		slog.Error("nara preview: checking for already imported pumping", "error", err)
		writeNaraError(w, http.StatusInternalServerError, "generic", "", "couldn't read the database")
		return
	}
	plan.dropDuplicatePumps()
	body := naraSummary(plan, opts)
	body["status"] = "preview"
	body["profile"] = plan.Profile
	pagination.WriteJSON(w, http.StatusOK, body)
}

// Import creates a child from the submitted details and imports a Nara Baby
// CSV export into it, all in one transaction.
// POST /api/import/nara (multipart: file, first_name, last_name, birth_date,
// sex, unit_system, timezone, duplicate_pumping)
func (h *NaraImportHandler) Import(w http.ResponseWriter, r *http.Request) {
	plan, opts, ok := h.readUpload(w, r)
	if !ok {
		return
	}
	defer r.MultipartForm.RemoveAll()

	firstName := strings.TrimSpace(r.FormValue("first_name"))
	lastName := strings.TrimSpace(r.FormValue("last_name"))
	birthDate := r.FormValue("birth_date")
	sex := r.FormValue("sex")
	if firstName == "" {
		writeNaraError(w, http.StatusBadRequest, "missing_name", "", "first name is required")
		return
	}
	if _, err := time.Parse("2006-01-02", birthDate); err != nil {
		writeNaraError(w, http.StatusBadRequest, "invalid_birth_date", "", "birth date must be YYYY-MM-DD")
		return
	}
	if sex != "" && sex != "male" && sex != "female" {
		writeNaraError(w, http.StatusBadRequest, "invalid_sex", "", "sex must be male, female, or empty")
		return
	}
	// Family pumping that's already in BabyTracker (from a sibling's export)
	// is skipped unless the user chose to import it for this baby too.
	includeDuplicates := r.FormValue("duplicate_pumping") == "import"

	child := naraChild{FirstName: firstName, LastName: lastName, BirthDate: birthDate, Sex: sex}
	childID, err := insertNaraPlan(r.Context(), h.db, child, plan, includeDuplicates)
	if errors.Is(err, errNaraNothingToImport) {
		// No empty child: on first run that would end onboarding with
		// nothing imported and nowhere to retry.
		body := naraSummary(plan, opts)
		body["error"] = "nothing in this file could be imported"
		body["code"] = "nothing_to_import"
		pagination.WriteJSON(w, http.StatusUnprocessableEntity, body)
		return
	}
	if err != nil {
		slog.Error("nara import failed", "error", err)
		writeNaraError(w, http.StatusInternalServerError, "import_failed", "", "import failed; nothing was saved")
		return
	}

	body := naraSummary(plan, opts)
	body["status"] = "completed"
	body["child_id"] = childID
	slog.Info("nara import completed", "child_id", childID, "stats", body["stats"],
		"skipped", plan.Skipped, "rejected", plan.RejectedCount, "warnings", plan.WarningCount)
	pagination.WriteJSON(w, http.StatusOK, body)
}

// readUpload checks access, reads the multipart upload and parses the export.
// On failure it has already written the response. On success the caller must
// RemoveAll the multipart form.
func (h *NaraImportHandler) readUpload(w http.ResponseWriter, r *http.Request) (*naraPlan, naraOptions, bool) {
	if isAdmin, ok := r.Context().Value(middleware.IsAdminKey).(bool); !ok || !isAdmin {
		pagination.WriteError(w, http.StatusForbidden, "admin access required")
		return nil, naraOptions{}, false
	}

	r.Body = http.MaxBytesReader(w, r.Body, naraMaxUpload)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			limit := strconv.FormatInt(tooLarge.Limit>>20, 10)
			writeNaraError(w, http.StatusRequestEntityTooLarge, "too_large", limit,
				fmt.Sprintf("the upload is larger than the %s MB limit", limit))
		} else {
			writeNaraError(w, http.StatusBadRequest, "invalid_upload", "", "invalid upload")
		}
		return nil, naraOptions{}, false
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		r.MultipartForm.RemoveAll()
		writeNaraError(w, http.StatusBadRequest, "invalid_upload", "", "export file required")
		return nil, naraOptions{}, false
	}
	defer file.Close()

	opts := naraOptions{UnitSystem: h.cfg.UnitSystem, Location: time.UTC, Now: h.now()}
	// The frontend sends the unit system the importing device displays, since
	// stored values carry no unit and each device labels them with its own
	// setting.
	if us := r.FormValue("unit_system"); us == "metric" || us == "imperial" {
		opts.UnitSystem = us
	}
	if tz := r.FormValue("timezone"); tz != "" {
		if loc, err := time.LoadLocation(tz); err == nil {
			opts.Location = loc
		} else {
			slog.Warn("nara import: unknown browser time zone, using UTC for rows without one", "timezone", tz)
		}
	}

	plan, err := parseNaraExport(file, opts)
	if err != nil {
		r.MultipartForm.RemoveAll()
		var fe *naraFileError
		if errors.As(err, &fe) {
			writeNaraError(w, fe.Status, fe.Code, fe.Detail, fe.Message)
		} else {
			writeNaraError(w, http.StatusBadRequest, "bad_csv", "", err.Error())
		}
		return nil, naraOptions{}, false
	}
	return plan, opts, true
}

func naraSummary(p *naraPlan, opts naraOptions) map[string]any {
	orEmpty := func(list []naraIssue) []naraIssue {
		if list == nil {
			return []naraIssue{}
		}
		return list
	}
	children := p.Duplicates.Children
	if children == nil {
		children = []string{}
	}
	return map[string]any{
		"stats":             p.stats(),
		"skipped":           p.Skipped,
		"as_notes":          p.AsNotes,
		"duplicate_pumping": map[string]any{"count": p.Duplicates.Count, "children": children},
		"solid_feeds":       p.SolidFeeds,
		"rejected":          orEmpty(p.Rejected),
		"rejected_count":    p.RejectedCount,
		"warnings":          orEmpty(p.Warnings),
		"warning_count":     p.WarningCount,
		"units":             naraUnitLabels(opts.UnitSystem),
	}
}

func naraUnitLabels(system string) map[string]string {
	if system == "imperial" {
		return map[string]string{"volume": "oz", "weight": "lb", "length": "in", "temperature": "°F"}
	}
	return map[string]string{"volume": "mL", "weight": "kg", "length": "cm", "temperature": "°C"}
}

// --- Plan ---

type naraOptions struct {
	UnitSystem string         // "metric" or "imperial"; values are stored in these units
	Location   *time.Location // for rows with no usable Time Zone
	Now        time.Time      // upper bound for plausible timestamps
}

type naraChild struct {
	FirstName, LastName, BirthDate, Sex string
}

type naraProfile struct {
	Name      string `json:"name"`
	BirthDate string `json:"birth_date"`
	Sex       string `json:"sex"`
}

type naraFeeding struct {
	Start, End   time.Time
	Type, Method string
	Amount       *float64
	Notes        string
}

type naraSleep struct {
	Start, End time.Time
	Nap        bool
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
	Note       string // pumping entries have no notes field; saved as a note
	Family     bool   // logged for the family, not this child (no profile)
	Duplicate  bool   // a family session that's already in the database
}

type naraMeasurement struct {
	Date  string // YYYY-MM-DD in the row's time zone
	Value float64
	Notes string
}

type naraTemperature struct {
	Time  time.Time
	Value float64
	Notes string
}

type naraMedication struct {
	Time                     time.Time
	Name, Dosage, DosageUnit string
	Notes                    string
}

type naraMilestone struct {
	Date, Title, Description string
}

type naraNote struct {
	Time time.Time
	Note string
}

// naraPlan is everything parsed out of one export, ready to insert.
type naraPlan struct {
	Profile     naraProfile
	Feedings    []naraFeeding
	Sleep       []naraSleep
	Changes     []naraChange
	Pumping     []naraPumping
	Weight      []naraMeasurement
	Height      []naraMeasurement
	HeadCirc    []naraMeasurement
	Temperature []naraTemperature
	Medications []naraMedication
	Milestones  []naraMilestone
	Notes       []naraNote
	Skipped     map[string]int // Nara row types not imported
	AsNotes     map[string]int // rows with no BabyTracker equivalent, kept as notes
	SolidFeeds  int            // feedings from Solid Feed rows (saved as parent fed)
	// Family pumping sessions already in the database, from a sibling's
	// export, and the children that hold them.
	Duplicates struct {
		Count    int
		Children []string
	}
	// The first naraIssueCap issues of each kind, and the full counts.
	Rejected      []naraIssue
	RejectedCount int
	Warnings      []naraIssue
	WarningCount  int

	zones map[string]*time.Location
}

func (p *naraPlan) stats() map[string]int {
	return map[string]int{
		"feedings":           len(p.Feedings),
		"sleep":              len(p.Sleep),
		"changes":            len(p.Changes),
		"pumping":            len(p.Pumping),
		"weight":             len(p.Weight),
		"height":             len(p.Height),
		"head_circumference": len(p.HeadCirc),
		"temperature":        len(p.Temperature),
		"medications":        len(p.Medications),
		"milestones":         len(p.Milestones),
		"notes":              len(p.Notes) + p.pumpNotes(),
	}
}

func (p *naraPlan) pumpNotes() int {
	n := 0
	for _, pm := range p.Pumping {
		if pm.Note != "" {
			n++
		}
	}
	return n
}

// markDuplicatePumps flags family pumping sessions (rows with no profile)
// that are already in the database. Nara can include the family's pumping in
// each child's export, so importing a sibling would otherwise add them again.
// A session matches on its start and end, which don't depend on the unit
// system the amounts were converted to.
func markDuplicatePumps(q sqlx.Queryer, p *naraPlan) error {
	var lo, hi time.Time
	for _, pm := range p.Pumping {
		if !pm.Family {
			continue
		}
		if lo.IsZero() || pm.Start.Before(lo) {
			lo = pm.Start
		}
		if hi.IsZero() || pm.Start.After(hi) {
			hi = pm.Start
		}
	}
	if lo.IsZero() {
		return nil
	}
	var existing []struct {
		Start time.Time `db:"start_time"`
		End   time.Time `db:"end_time"`
		Child string    `db:"first_name"`
	}
	if err := sqlx.Select(q, &existing,
		`SELECT p.start_time, p.end_time, c.first_name FROM pumping p JOIN children c ON c.id = p.child_id
		 WHERE p.start_time BETWEEN $1 AND $2`, lo, hi); err != nil {
		return err
	}
	type key struct{ start, end int64 }
	owner := make(map[key]string, len(existing))
	for _, e := range existing {
		owner[key{e.Start.UnixMicro(), e.End.UnixMicro()}] = e.Child
	}
	seen := map[string]bool{}
	for i, pm := range p.Pumping {
		child, ok := owner[key{pm.Start.UnixMicro(), pm.End.UnixMicro()}]
		if !pm.Family || !ok {
			continue
		}
		p.Pumping[i].Duplicate = true
		p.Duplicates.Count++
		if !seen[child] {
			seen[child] = true
			p.Duplicates.Children = append(p.Duplicates.Children, child)
		}
	}
	return nil
}

// dropDuplicatePumps removes the sessions markDuplicatePumps flagged.
func (p *naraPlan) dropDuplicatePumps() {
	kept := p.Pumping[:0]
	for _, pm := range p.Pumping {
		if !pm.Duplicate {
			kept = append(kept, pm)
		}
	}
	p.Pumping = kept
}

func (p *naraPlan) total() int {
	n := 0
	for _, v := range p.stats() {
		n += v
	}
	return n
}

// warn and reject record an issue. Only the first naraIssueCap of each are
// kept, so a broken file can't fill memory; the counts are exact.
func (p *naraPlan) warn(row *naraRow, code, detail, reason string) {
	p.WarningCount++
	if len(p.Warnings) < naraIssueCap {
		p.Warnings = append(p.Warnings, naraIssue{Line: row.line, Type: row.typ, Code: code, Detail: detail, Reason: reason})
	}
}

func (p *naraPlan) reject(issue naraIssue) {
	p.RejectedCount++
	if len(p.Rejected) < naraIssueCap {
		p.Rejected = append(p.Rejected, issue)
	}
}

func (p *naraPlan) note(at time.Time, text string) {
	p.Notes = append(p.Notes, naraNote{Time: at, Note: text})
}

// zone returns the row's own time zone (Nara records one per row, and it
// changes when the family travels), falling back to the importer's.
func (p *naraPlan) zone(row *naraRow, opts naraOptions) *time.Location {
	name := row.get("Time Zone")
	if name == "" {
		return opts.Location
	}
	if loc, ok := p.zones[name]; ok {
		return loc
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		loc = opts.Location
	}
	p.zones[name] = loc
	return loc
}

// insertNaraPlan creates the child and inserts the plan in one transaction,
// which is rolled back if the request is cancelled. Family pumping already in
// the database is left out unless includeDuplicates is set. It returns
// errNaraNothingToImport, without creating the child, when nothing is left.
func insertNaraPlan(ctx context.Context, db *sqlx.DB, c naraChild, p *naraPlan, includeDuplicates bool) (int, error) {
	tx, err := db.BeginTxx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	if err := markDuplicatePumps(tx, p); err != nil {
		return 0, fmt.Errorf("check pumping: %w", err)
	}
	if !includeDuplicates {
		p.dropDuplicatePumps()
	}
	if p.total() == 0 {
		return 0, errNaraNothingToImport
	}

	var sex any
	if c.Sex != "" {
		sex = c.Sex
	}
	var childID int
	if err := tx.QueryRow(
		`INSERT INTO children (first_name, last_name, birth_date, sex) VALUES ($1, $2, $3, $4) RETURNING id`,
		c.FirstName, c.LastName, c.BirthDate, sex,
	).Scan(&childID); err != nil {
		return 0, fmt.Errorf("insert child: %w", err)
	}

	type insert struct {
		what  string
		query string
		args  [][]any
	}
	var batches []insert
	add := func(what, query string, args []any) {
		if len(batches) == 0 || batches[len(batches)-1].what != what {
			batches = append(batches, insert{what: what, query: query})
		}
		batches[len(batches)-1].args = append(batches[len(batches)-1].args, args)
	}
	for _, f := range p.Feedings {
		add("feeding", `INSERT INTO feedings (child_id, start_time, end_time, type, method, amount, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			[]any{childID, f.Start, f.End, f.Type, f.Method, f.Amount, f.Notes})
	}
	for _, s := range p.Sleep {
		add("sleep", `INSERT INTO sleep (child_id, start_time, end_time, nap, notes) VALUES ($1,$2,$3,$4,$5)`,
			[]any{childID, s.Start, s.End, s.Nap, s.Notes})
	}
	for _, ch := range p.Changes {
		add("change", `INSERT INTO changes (child_id, time, wet, solid, color, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
			[]any{childID, ch.Time, ch.Wet, ch.Solid, ch.Color, ch.Notes})
	}
	for _, pm := range p.Pumping {
		add("pumping", `INSERT INTO pumping (child_id, start_time, end_time, amount) VALUES ($1,$2,$3,$4)`,
			[]any{childID, pm.Start, pm.End, pm.Amount})
	}
	for _, m := range p.Weight {
		add("weight", `INSERT INTO weight (child_id, date, weight, notes) VALUES ($1,$2,$3,$4)`,
			[]any{childID, m.Date, m.Value, m.Notes})
	}
	for _, m := range p.Height {
		add("height", `INSERT INTO height (child_id, date, height, notes) VALUES ($1,$2,$3,$4)`,
			[]any{childID, m.Date, m.Value, m.Notes})
	}
	for _, m := range p.HeadCirc {
		add("head circumference", `INSERT INTO head_circumference (child_id, date, head_circumference, notes) VALUES ($1,$2,$3,$4)`,
			[]any{childID, m.Date, m.Value, m.Notes})
	}
	for _, t := range p.Temperature {
		add("temperature", `INSERT INTO temperature (child_id, time, temperature, notes) VALUES ($1,$2,$3,$4)`,
			[]any{childID, t.Time, t.Value, t.Notes})
	}
	for _, m := range p.Medications {
		add("medication", `INSERT INTO medications (child_id, time, name, dosage, dosage_unit, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
			[]any{childID, m.Time, m.Name, m.Dosage, m.DosageUnit, m.Notes})
	}
	for _, m := range p.Milestones {
		add("milestone", `INSERT INTO milestones (child_id, date, title, description) VALUES ($1,$2,$3,$4)`,
			[]any{childID, m.Date, m.Title, m.Description})
	}
	for _, n := range p.Notes {
		add("note", `INSERT INTO notes (child_id, time, note) VALUES ($1,$2,$3)`,
			[]any{childID, n.Time, n.Note})
	}
	for _, pm := range p.Pumping {
		if pm.Note != "" {
			add("note", `INSERT INTO notes (child_id, time, note) VALUES ($1,$2,$3)`,
				[]any{childID, pm.Start, "Pumping: " + pm.Note})
		}
	}

	for _, b := range batches {
		stmt, err := tx.PrepareContext(ctx, b.query)
		if err != nil {
			return 0, fmt.Errorf("prepare %s insert: %w", b.what, err)
		}
		for _, args := range b.args {
			if _, err := stmt.ExecContext(ctx, args...); err != nil {
				stmt.Close()
				return 0, fmt.Errorf("insert %s: %w", b.what, err)
			}
		}
		stmt.Close()
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return childID, nil
}

// --- Parsing ---

// naraRow gives column access by header name for one CSV record.
type naraRow struct {
	cols     map[string]int
	record   []string
	line     int    // physical line the record starts on
	typ      string // the row's Type
	repaired bool   // a field held bytes that aren't valid UTF-8, or NULs
}

// get returns a column's trimmed value ("" if the export has no such
// column). Text Postgres can't store is repaired rather than failing the
// whole import; the row is flagged so the user can check it.
func (r *naraRow) get(col string) string {
	i, ok := r.cols[col]
	if !ok || i >= len(r.record) {
		return ""
	}
	v := strings.TrimSpace(r.record[i])
	if !utf8.ValidString(v) || strings.IndexByte(v, 0) >= 0 {
		v = strings.ReplaceAll(strings.ToValidUTF8(v, "\uFFFD"), "\x00", "")
		r.repaired = true
	}
	return v
}

func parseNaraExport(src io.Reader, opts naraOptions) (*naraPlan, error) {
	if opts.Location == nil {
		opts.Location = time.UTC
	}
	if opts.Now.IsZero() {
		opts.Now = time.Now()
	}

	// Strip a UTF-8 BOM before the CSV reader sees it: in front of a quoted
	// header cell it would make the reader treat the cell as unquoted.
	br := bufio.NewReader(src)
	if b, err := br.Peek(3); err == nil && bytes.Equal(b, []byte{0xEF, 0xBB, 0xBF}) {
		br.Discard(3)
	}
	cr := csv.NewReader(br)
	cr.FieldsPerRecord = -1 // checked per row below, so one bad row doesn't sink the file

	header, err := cr.Read()
	if err != nil {
		return nil, errNotNaraExport
	}
	cols := make(map[string]int, len(header))
	for i, h := range header {
		cols[strings.TrimSpace(h)] = i
	}
	for _, required := range []string{"Type", "Start Date/time (Epoch)"} {
		if _, ok := cols[required]; !ok {
			return nil, errNotNaraExport
		}
	}

	p := &naraPlan{Skipped: map[string]int{}, AsNotes: map[string]int{}, zones: map[string]*time.Location{}}
	for {
		record, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			line := 0
			var pe *csv.ParseError
			if errors.As(err, &pe) {
				line = pe.StartLine // where the bad record starts, not where reading stopped
			}
			return nil, &naraFileError{
				Status: http.StatusBadRequest, Code: "bad_csv", Detail: strconv.Itoa(line),
				Message: fmt.Sprintf("the file isn't valid CSV near line %d", line),
			}
		}
		line, _ := cr.FieldPos(0)
		row := &naraRow{cols: cols, record: record, line: line}
		row.typ = row.get("Type")
		switch {
		case row.typ == "":
			continue
		case row.typ == "Profile":
			p.addProfile(row)
			continue
		case len(record) != len(header):
			p.reject(naraIssue{
				Line: line, Type: row.typ, Code: "field_count",
				Detail: strconv.Itoa(len(header)), Value: strconv.Itoa(len(record)),
				Reason: fmt.Sprintf("the row has %d columns, the header has %d", len(record), len(header)),
			})
			continue
		}

		warnings, warningCount := len(p.Warnings), p.WarningCount
		if err := p.addRow(row, opts); err != nil {
			if errors.Is(err, errNaraSpreadsheet) {
				return nil, errNaraSpreadsheet
			}
			var re *naraRowError
			if !errors.As(err, &re) {
				re = &naraRowError{Code: "invalid", Reason: err.Error()}
			}
			// A rejected row has no warnings.
			p.Warnings, p.WarningCount = p.Warnings[:warnings], warningCount
			p.reject(naraIssue{Line: line, Type: row.typ, Code: re.Code, Detail: re.Detail, Value: re.Value, Reason: re.Reason})
			continue
		}
		if row.repaired {
			p.warn(row, "text_repaired", "", "some text couldn't be read and was replaced")
		}
	}
	return p, nil
}

func (p *naraPlan) addProfile(row *naraRow) {
	// Only a child profile (a parent's export may have another Type, or none).
	if t := row.get("[Profile] Type"); t != "" && !strings.EqualFold(t, "CHILD") {
		return
	}
	if p.Profile.Name != "" || p.Profile.BirthDate != "" {
		return
	}
	p.Profile.Name = row.get("Profile Name")
	if bd := row.get("[Profile] Birth Date"); len(bd) >= 10 {
		if _, err := time.Parse("2006-01-02", bd[:10]); err == nil {
			p.Profile.BirthDate = bd[:10]
		}
	}
	switch strings.ToUpper(row.get("[Profile] Sex")) {
	case "FEMALE":
		p.Profile.Sex = "female"
	case "MALE":
		p.Profile.Sex = "male"
	}
}

func (p *naraPlan) addRow(row *naraRow, opts naraOptions) error {
	switch row.typ {
	case "Breastfeed", "Bottle Feed", "Combo Feed", "Solid Feed", "Diaper", "Pump", "Sleep",
		"Growth", "Medical", "Milestone", "Baby First", "Routine", "Vaccine":
	default:
		// Nara's parent export uses "Postpartum ..." types; they aren't the
		// baby's, so not even their notes are kept.
		if strings.HasPrefix(row.typ, "Postpartum ") {
			p.Skipped[row.typ]++
			return nil
		}
		// Unknown types aren't imported, but a note written on one is kept.
		if note := row.get("Note"); note != "" {
			if at, ok, err := p.naraTime(row, "Start Date/time", "start time", opts); err == nil && ok {
				p.note(at, row.typ+": "+note)
				p.AsNotes[row.typ]++
				return nil
			}
		}
		p.Skipped[row.typ]++
		return nil
	}

	start, ok, err := p.naraTime(row, "Start Date/time", "start time", opts)
	if err != nil {
		return err
	}
	if !ok {
		return rowErr("bad_start_time", "", "the start time is missing")
	}
	note := row.get("Note")

	switch row.typ {
	case "Breastfeed":
		f, has, err := naraBreastfeed(row, "Breastfeed", start)
		if err != nil {
			return err
		}
		if !has {
			p.warn(row, "side_unknown", "", "no side or duration recorded; imported as both breasts")
			f.Notes = joinNotes("Side not recorded in Nara", note)
		} else {
			f.Notes = note
		}
		p.Feedings = append(p.Feedings, f)

	case "Bottle Feed":
		fs, err := p.naraBottle(row, "Bottle Feed", start, opts)
		if err != nil {
			return err
		}
		for i := range fs {
			fs[i].Notes = joinNotes(fs[i].Notes, note)
		}
		p.Feedings = append(p.Feedings, fs...)

	case "Combo Feed":
		// A breastfeed with a top-up bottle becomes a breastfeed plus one
		// bottle feeding per milk type, since a feeding has one method.
		breast, hasBreast, err := naraBreastfeed(row, "Combo Feed", start)
		if err != nil {
			return err
		}
		var bottles []naraFeeding
		if naraHasBottle(row, "Combo Feed") {
			if bottles, err = p.naraBottle(row, "Combo Feed", start, opts); err != nil {
				return err
			}
		}
		if !hasBreast && len(bottles) == 0 {
			return rowErr("empty_entry", "", "nothing recorded in this entry")
		}
		if hasBreast {
			breast.Notes = note
			p.Feedings = append(p.Feedings, breast)
		}
		for i := range bottles {
			bottles[i].Notes = joinNotes(bottles[i].Notes, note)
		}
		p.Feedings = append(p.Feedings, bottles...)

	case "Solid Feed":
		f, err := naraSolid(row, start)
		if err != nil {
			return err
		}
		f.Notes = joinNotes(f.Notes, note)
		p.Feedings = append(p.Feedings, f)
		p.SolidFeeds++

	case "Diaper":
		c, dry, err := naraDiaper(row, start)
		if err != nil {
			return err
		}
		if dry {
			// BabyTracker diapers are wet and/or solid; a dry check is kept
			// as a note rather than shown as a wet diaper.
			p.note(start, joinNotes("Dry diaper", c.Notes, note))
			p.AsNotes["Dry diaper"]++
			return nil
		}
		c.Notes = joinNotes(c.Notes, note)
		p.Changes = append(p.Changes, c)

	case "Pump":
		pm, err := p.naraPump(row, start, opts)
		if err != nil {
			return err
		}
		pm.Note = note
		p.Pumping = append(p.Pumping, pm)

	case "Sleep":
		end, err := p.naraEnd(row, "Sleep", start, opts)
		if err != nil {
			return err
		}
		if end.Equal(start) {
			if row.get("[Sleep] End Date/time (Epoch)") == "" && row.get("[Sleep] End Date/time") == "" && row.get("[Sleep] Duration (Seconds)") == "" {
				return rowErr("no_end_time", "", "no end time or duration")
			}
			return rowErr("zero_length", "", "the sleep ends when it starts")
		}
		p.Sleep = append(p.Sleep, naraSleep{Start: start, End: end, Nap: naraIsNap(start, end, p.zone(row, opts)), Notes: note})

	case "Growth":
		return p.addGrowth(row, start, note, opts)

	case "Medical":
		return p.addMedical(row, start, note, opts)

	case "Milestone", "Baby First":
		title := row.get("[" + row.typ + "] " + row.typ)
		if title == "" {
			title = note
		}
		if title == "" {
			return rowErr("empty_entry", "", "nothing recorded in this entry")
		}
		desc := note
		if desc == title {
			desc = ""
		}
		p.Milestones = append(p.Milestones, naraMilestone{
			Date: start.In(p.zone(row, opts)).Format("2006-01-02"), Title: title, Description: desc,
		})

	case "Routine", "Vaccine":
		// No matching entry type (a Routine has no duration to make a tummy
		// time from); keep what was recorded as a note.
		what := row.get("[" + row.typ + "] " + row.typ)
		text := joinNotes(what, note)
		if text == "" {
			return rowErr("empty_entry", "", "nothing recorded in this entry")
		}
		p.note(start, row.typ+": "+text)
		p.AsNotes[row.typ]++
	}
	return nil
}

func naraBreastfeed(row *naraRow, prefix string, start time.Time) (naraFeeding, bool, error) {
	l, err := naraDuration(row, "["+prefix+"] Left Duration (Seconds)")
	if err != nil {
		return naraFeeding{}, false, err
	}
	r, err := naraDuration(row, "["+prefix+"] Right Duration (Seconds)")
	if err != nil {
		return naraFeeding{}, false, err
	}
	if l+r > naraMaxDuration {
		return naraFeeding{}, false, rowErr("too_long", "", "lasts longer than 24 hours")
	}
	begin := naraSide(row.get("[" + prefix + "] Begin Side"))
	end := naraSide(row.get("[" + prefix + "] End Side"))

	var method string
	switch {
	case l > 0 && r > 0:
		method = "both breasts"
	case l > 0:
		method = "left breast"
	case r > 0:
		method = "right breast"
	default:
		// No timed sides: use the recorded sides. Different begin and end
		// sides mean both were used.
		if begin == "" {
			begin = end
		}
		if end == "" {
			end = begin
		}
		switch {
		case begin == "left" && end == "left":
			method = "left breast"
		case begin == "right" && end == "right":
			method = "right breast"
		default:
			method = "both breasts"
		}
	}
	has := l > 0 || r > 0 || begin != "" || end != ""
	return naraFeeding{Start: start, End: start.Add(l + r), Type: "breast milk", Method: method}, has, nil
}

// naraSide normalizes "LEFT", "Right.nonTimer" style values to left, right or
// both ("" if unrecognized). The .nonTimer suffix marks a manually entered
// side.
func naraSide(v string) string {
	v = strings.ToLower(v)
	v = strings.TrimSuffix(v, ".nontimer")
	switch v {
	case "left", "right", "both":
		return v
	}
	return ""
}

// naraHasBottle reports whether a row records anything about a bottle.
func naraHasBottle(row *naraRow, prefix string) bool {
	for _, c := range []string{"Type", "Breast Milk Volume", "Formula Volume", "Volume", "Formula Name"} {
		if row.get("["+prefix+"] "+c) != "" {
			return true
		}
	}
	return false
}

// naraBottle maps a bottle to one feeding per milk type. A mixed bottle with
// a recorded split becomes two feedings (as a Combo Feed does), so per-type
// totals and the milk stash stay right.
func (p *naraPlan) naraBottle(row *naraRow, prefix string, start time.Time, opts naraOptions) ([]naraFeeding, error) {
	col := func(name string) string { return "[" + prefix + "] " + name }
	kind := strings.ToLower(row.get(col("Type")))
	hasBM := strings.Contains(kind, "breast milk")
	hasFormula := strings.Contains(kind, "formula")

	bm, err := naraVolume(row, col("Breast Milk Volume"), opts)
	if err != nil {
		return nil, err
	}
	formula, err := naraVolume(row, col("Formula Volume"), opts)
	if err != nil {
		return nil, err
	}
	total, err := naraVolume(row, col("Volume"), opts)
	if err != nil {
		return nil, err
	}
	positive := func(v *float64) bool { return v != nil && *v > 0 }
	unit := naraUnitLabels(opts.UnitSystem)["volume"]
	brand := row.get(col("Formula Name"))
	formulaNote := ""
	if brand != "" {
		formulaNote = "Formula: " + brand
	}
	feeding := func(typ string, amount *float64, notes string) naraFeeding {
		return naraFeeding{Start: start, End: start, Type: typ, Method: "bottle", Amount: amount, Notes: notes}
	}

	mixed := func(b, f *float64, extra string) []naraFeeding {
		split := fmt.Sprintf("Mixed bottle: %s %s breast milk + %s %s formula", formatAmount(*b), unit, formatAmount(*f), unit)
		return []naraFeeding{
			feeding("breast milk", b, joinNotes(split, extra)),
			feeding("formula", f, joinNotes(split, extra, formulaNote)),
		}
	}
	switch {
	case positive(bm) && positive(formula):
		return mixed(bm, formula, ""), nil
	case (positive(bm) || positive(formula)) && hasBM && hasFormula:
		// A mixed bottle with one share recorded. If the generic Volume is
		// larger, it's the total, so the other share is the difference.
		have := bm
		if positive(formula) {
			have = formula
		}
		if positive(total) && *total > *have {
			other := roundVolume(*total-*have, opts.UnitSystem)
			p.warn(row, "mixed_derived", "", "mixed bottle with one share recorded; the other share is the total minus that share")
			if have == bm {
				return mixed(bm, &other, "formula share worked out from the total"), nil
			}
			return mixed(&other, formula, "breast milk share worked out from the total"), nil
		}
		p.warn(row, "mixed_partial", "", "mixed bottle with only one share recorded")
		if have == bm {
			return []naraFeeding{feeding("breast milk", bm, "Mixed bottle; only the breast milk share recorded in Nara")}, nil
		}
		return []naraFeeding{feeding("formula", formula, joinNotes("Mixed bottle; only the formula share recorded in Nara", formulaNote))}, nil
	case positive(bm):
		return []naraFeeding{feeding("breast milk", bm, "")}, nil
	case positive(formula):
		return []naraFeeding{feeding("formula", formula, formulaNote)}, nil
	}

	// No per-type volume: the generic Volume, typed by the Type column.
	amount := total
	if amount == nil {
		// Volumes exported as "0" next to an empty total: keep the zero.
		for _, v := range []*float64{bm, formula} {
			if v != nil {
				amount = v
			}
		}
	}
	switch {
	case hasFormula && !hasBM, !hasBM && !hasFormula && brand != "":
		// A formula brand with no Type still means a formula bottle.
		return []naraFeeding{feeding("formula", amount, formulaNote)}, nil
	case hasBM && !hasFormula:
		return []naraFeeding{feeding("breast milk", amount, "")}, nil
	case hasBM && hasFormula:
		p.warn(row, "mixed_no_split", "", "mixed bottle with no breast milk/formula split; imported as breast milk")
		return []naraFeeding{feeding("breast milk", amount, joinNotes("Mixed bottle (breast milk + formula), split not recorded in Nara", formulaNote))}, nil
	default:
		p.warn(row, "milk_type_unknown", "", "milk type not recorded; imported as breast milk")
		return []naraFeeding{feeding("breast milk", amount, joinNotes("Milk type not recorded in Nara", formulaNote))}, nil
	}
}

// naraFoodTag matches Nara's tagged solid food lines, e.g.
// "Cereal: amountKey=ALL; preparationKeyz=PUREE".
var naraFoodTag = regexp.MustCompile(`^([^:]+):\s*(\w+=.*)$`)

// naraFoodTagNames labels the tag keys seen in exports.
var naraFoodTagNames = map[string]string{"amountKey": "amount", "preparationKeyz": "preparation", "foodCategoryKey": "category"}

// naraFood turns "Cereal: amountKey=ALL; preparationKeyz=PUREE" into
// "Cereal (amount: all, preparation: puree)".
func naraFood(line string) string {
	m := naraFoodTag.FindStringSubmatch(line)
	if m == nil {
		return line
	}
	var tags []string
	for _, kv := range strings.Split(m[2], ";") {
		k, v, ok := strings.Cut(strings.TrimSpace(kv), "=")
		if !ok || strings.TrimSpace(v) == "" {
			continue
		}
		name, known := naraFoodTagNames[k]
		if !known {
			name = strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(k, "Keyz"), "Key"))
		}
		tags = append(tags, name+": "+strings.ToLower(strings.TrimSpace(v)))
	}
	name := strings.TrimSpace(m[1])
	if len(tags) == 0 {
		return name
	}
	return name + " (" + strings.Join(tags, ", ") + ")"
}

func naraSolid(row *naraRow, start time.Time) (naraFeeding, error) {
	var foods []string
	for _, line := range strings.Split(row.get("[Solid Feed] Food"), "\n") {
		if line = naraFood(strings.TrimSpace(line)); line != "" {
			foods = append(foods, line)
		}
	}
	var notes []string
	if len(foods) > 0 {
		notes = append(notes, "Food: "+strings.Join(foods, ", "))
	}
	if meal := row.get("[Solid Feed] Meal"); meal != "" {
		notes = append(notes, "Meal: "+strings.ToLower(meal))
	}
	// Nara doesn't record who held the spoon; parent fed is the common case
	// for babies on solids and can be changed per entry.
	return naraFeeding{Start: start, End: start, Type: "solid food", Method: "parent fed", Notes: strings.Join(notes, "; ")}, nil
}

// changes.color only accepts these; anything else goes into the notes.
var naraChangeColors = map[string]bool{"black": true, "brown": true, "green": true, "yellow": true}

var naraTextures = map[string]string{
	"RUN": "runny", "MUCOUS": "mucousy", "MUSH": "mushy", "SOLID": "solid", "PEBBLE": "pebbles",
}

// naraDiaper maps a diaper row. dry reports a dry check (neither wet nor
// dirty), which the caller keeps as a note.
func naraDiaper(row *naraRow, at time.Time) (c naraChange, dry bool, err error) {
	kind := strings.ToLower(row.get("[Diaper] Type"))
	wet := strings.Contains(kind, "wet")
	dirty := strings.Contains(kind, "dirty")
	dry = strings.Contains(kind, "dry") && !wet && !dirty
	if kind == "" {
		return naraChange{}, false, rowErr("missing_diaper_type", "", "no diaper type recorded")
	}
	if !wet && !dirty && !dry {
		return naraChange{}, false, rowErrValue("unknown_diaper_type", "[Diaper] Type", row.get("[Diaper] Type"),
			"unrecognized diaper type %q", row.get("[Diaper] Type"))
	}
	c = naraChange{Time: at, Wet: wet, Solid: dirty}

	var notes, otherColors, textures, details []string
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
	for _, tok := range strings.FieldsFunc(row.get("[Diaper] Detail"), func(r rune) bool { return r == ' ' || r == ',' }) {
		details = append(details, tok)
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
	notes = append(notes, details...)
	c.Notes = strings.Join(notes, "; ")
	return c, dry, nil
}

func (p *naraPlan) naraPump(row *naraRow, start time.Time, opts naraOptions) (naraPumping, error) {
	left, err := naraVolume(row, "[Pump] Left Volume", opts)
	if err != nil {
		return naraPumping{}, err
	}
	right, err := naraVolume(row, "[Pump] Right Volume", opts)
	if err != nil {
		return naraPumping{}, err
	}
	total, err := naraVolume(row, "[Pump] Total Volume", opts)
	if err != nil {
		return naraPumping{}, err
	}
	end, err := p.naraEnd(row, "Pump", start, opts)
	if err != nil {
		return naraPumping{}, err
	}
	if left == nil && right == nil && total == nil && end.Equal(start) {
		// No amount and no length: nothing was recorded (or the timer was
		// still running when the export was made).
		return naraPumping{}, rowErr("empty_entry", "", "nothing recorded in this entry")
	}

	// Pumping is logged for the family, so a pump row can have no profile.
	family := row.get("_profileKey") == "" || row.get("Profile Name") == ""
	pm := naraPumping{Start: start, End: end, Family: family}
	var sides float64
	if left != nil {
		sides += *left
	}
	if right != nil {
		sides += *right
	}
	switch {
	case total != nil && *total > 0:
		// Nara's own total, when it wrote one (a session logged as a
		// total only, or alongside the sides).
		pm.Amount = total
	case sides > 0:
		v := roundVolume(sides, opts.UnitSystem)
		pm.Amount = &v
	case total != nil:
		pm.Amount = total
	case left != nil || right != nil:
		pm.Amount = &sides // explicit zeros
	}
	if pm.Amount != nil && *pm.Amount > naraVolumeLimit(opts.UnitSystem) {
		return naraPumping{}, rowErr("out_of_range", "[Pump] Total Volume", "the pumped volume is implausibly large")
	}
	return pm, nil
}

// naraEnd reads `[T] End Date/time (Epoch)`, falling back to the local
// `[T] End Date/time`, then to `[T] Duration (Seconds)`, then to the start
// time.
func (p *naraPlan) naraEnd(row *naraRow, prefix string, start time.Time, opts naraOptions) (time.Time, error) {
	end, ok, err := p.naraTime(row, "["+prefix+"] End Date/time", "end time", opts)
	if err != nil {
		return time.Time{}, err
	}
	if ok {
		if end.Before(start) {
			return time.Time{}, rowErr("end_before_start", "", "ends before it starts")
		}
	} else {
		d, err := naraDuration(row, "["+prefix+"] Duration (Seconds)")
		if err != nil {
			return time.Time{}, err
		}
		end = start.Add(d)
	}
	if end.Sub(start) > naraMaxDuration {
		return time.Time{}, rowErr("too_long", "", "lasts longer than 24 hours")
	}
	return end, nil
}

// naraDuration reads a seconds column, rejecting values over a day before
// they can overflow time.Duration.
func naraDuration(row *naraRow, col string) (time.Duration, error) {
	secs, err := naraOptionalNumber(row.get(col), col)
	if err != nil || secs == nil {
		return 0, err
	}
	if *secs > naraMaxDuration.Seconds() {
		return 0, rowErr("too_long", "", "lasts longer than 24 hours")
	}
	return time.Duration(math.Round(*secs)) * time.Second, nil
}

// naraIsNap classifies a sleep, since Nara doesn't record naps separately: a
// sleep that starts between 07:00 and 19:00 local time and lasts under four
// hours is a nap.
func naraIsNap(start, end time.Time, loc *time.Location) bool {
	h := start.In(loc).Hour()
	return h >= 7 && h < 19 && end.Sub(start) < 4*time.Hour
}

func (p *naraPlan) addGrowth(row *naraRow, at time.Time, note string, opts naraOptions) error {
	date := at.In(p.zone(row, opts)).Format("2006-01-02")
	imperial := opts.UnitSystem == "imperial"

	weight, err := naraOptionalNumber(row.get("[Growth] Weight"), "[Growth] Weight")
	if err != nil {
		return err
	}
	height, err := naraOptionalNumber(row.get("[Growth] Height"), "[Growth] Height")
	if err != nil {
		return err
	}
	head, err := naraOptionalNumber(row.get("[Growth] Head Size"), "[Growth] Head Size")
	if err != nil {
		return err
	}
	if weight == nil && height == nil && head == nil {
		return rowErr("no_measurements", "", "no weight, height, or head size")
	}

	// Validate every value before appending anything, so a bad row adds
	// nothing. Values are rounded to what the edit forms accept (0.01 for
	// weight, 0.1 for lengths) so imported entries can be edited.
	var w, h, hd float64
	if weight != nil {
		kg, err := naraToKg(*weight, row.get("[Growth] Weight Unit"), "[Growth] Weight")
		if err != nil {
			return err
		}
		if kg <= 0 || kg > naraMaxWeightKg {
			return rowErr("out_of_range", "[Growth] Weight", "the weight is implausible")
		}
		w = roundTo(kg, 2)
		if imperial {
			w = roundTo(kg/kgPerLb, 2)
		}
	}
	length := func(v float64, col string, max float64) (float64, error) {
		cm, err := naraToCm(v, row.get(col+" Unit"), col)
		if err != nil {
			return 0, err
		}
		if cm <= 0 || cm > max {
			return 0, rowErr("out_of_range", col, "%s is implausible", col)
		}
		if imperial {
			return roundTo(cm/cmPerIn, 1), nil
		}
		return roundTo(cm, 1), nil
	}
	if height != nil {
		if h, err = length(*height, "[Growth] Height", naraMaxHeightCm); err != nil {
			return err
		}
	}
	if head != nil {
		if hd, err = length(*head, "[Growth] Head Size", naraMaxHeadCm); err != nil {
			return err
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

// naraMedication matches Nara's medication text, e.g.
// "Children's Tylenol, 3.75 (ML)".
var naraMedicationDose = regexp.MustCompile(`^(.+?),\s*([0-9]+(?:[.,][0-9]+)?)\s*\(([^)]+)\)$`)

func (p *naraPlan) addMedical(row *naraRow, at time.Time, note string, opts naraOptions) error {
	// Read everything before appending, so a bad value rejects the whole row
	// rather than leaving half of it imported.
	// An entry may list several medicines, one per line (reported by another
	// importer; unverified).
	var meds []naraMedication
	for _, line := range strings.Split(row.get("[Medical] Medication"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		m := naraMedication{Time: at, Name: line}
		if parts := naraMedicationDose.FindStringSubmatch(line); parts != nil {
			m.Name, m.Dosage, m.DosageUnit = strings.TrimSpace(parts[1]), parts[2], strings.ToLower(parts[3])
		}
		if len(meds) == 0 {
			m.Notes = note
		}
		meds = append(meds, m)
	}
	var temp *naraTemperature
	tempValue, err := naraOptionalNumber(row.get("[Medical] Temperature"), "[Medical] Temperature")
	if err != nil {
		return err
	}
	if tempValue != nil {
		c, err := naraToCelsius(*tempValue, row.get("[Medical] Temperature Unit"), "[Medical] Temperature")
		if err != nil {
			return err
		}
		if c < naraMinTempC || c > naraMaxTempC {
			return rowErr("out_of_range", "[Medical] Temperature", "the temperature is implausible")
		}
		v := roundTo(c, 1)
		if opts.UnitSystem == "imperial" {
			v = roundTo(c*9/5+32, 1)
		}
		temp = &naraTemperature{Time: at, Value: v, Notes: note}
		if len(meds) > 0 {
			temp.Notes = "" // the note is already on the medication
		}
	}

	switch {
	case len(meds) == 0 && temp == nil && note == "":
		return rowErr("empty_entry", "", "nothing recorded in this entry")
	case len(meds) == 0 && temp == nil:
		p.note(at, "Medical: "+note)
		p.AsNotes["Medical"]++
	}
	p.Medications = append(p.Medications, meds...)
	if temp != nil {
		p.Temperature = append(p.Temperature, *temp)
	}
	return nil
}

// --- Values ---

// naraVolume reads a volume column and its "<col> Unit" companion, converting
// to the import's volume unit (mL for metric, fl oz for imperial).
func naraVolume(row *naraRow, col string, opts naraOptions) (*float64, error) {
	v, err := naraOptionalNumber(row.get(col), col)
	if err != nil || v == nil {
		return nil, err
	}
	var ml float64
	switch unit := strings.ToUpper(strings.NewReplacer(" ", "", "_", "", ".", "").Replace(row.get(col + " Unit"))); unit {
	case "ML":
		ml = *v
	case "OZ", "FLOZ":
		ml = *v * mlPerFlOz
	case "":
		// Assuming mL could store fl oz values 30x too small; report it.
		return nil, rowErr("missing_unit", col, "%s has no unit", col)
	default:
		return nil, rowErrValue("unknown_unit", col, unit, "%s has unknown unit %q", col, unit)
	}
	if ml > naraMaxVolumeML {
		return nil, rowErr("out_of_range", col, "%s is implausibly large", col)
	}
	out := roundVolume(ml, "metric")
	if opts.UnitSystem == "imperial" {
		out = roundVolume(ml/mlPerFlOz, "imperial")
	}
	return &out, nil
}

func roundVolume(v float64, system string) float64 {
	if system == "imperial" {
		return roundTo(v, 2)
	}
	return roundTo(v, 1)
}

func naraVolumeLimit(system string) float64 {
	if system == "imperial" {
		return naraMaxVolumeML / mlPerFlOz
	}
	return naraMaxVolumeML
}

func naraToKg(v float64, unit, col string) (float64, error) {
	switch strings.ToUpper(unit) {
	case "KG":
		return v, nil
	case "G":
		return v / 1000, nil
	case "LB", "LBS":
		return v * kgPerLb, nil
	case "OZ":
		return v * kgPerLb / 16, nil
	case "":
		return 0, rowErr("missing_unit", col, "%s has no unit", col)
	}
	return 0, rowErrValue("unknown_unit", col, unit, "%s has unknown unit %q", col, unit)
}

func naraToCm(v float64, unit, col string) (float64, error) {
	switch strings.ToUpper(unit) {
	case "CM":
		return v, nil
	case "MM":
		return v / 10, nil
	case "IN":
		return v * cmPerIn, nil
	case "":
		return 0, rowErr("missing_unit", col, "%s has no unit", col)
	}
	return 0, rowErrValue("unknown_unit", col, unit, "%s has unknown unit %q", col, unit)
}

func naraToCelsius(v float64, unit, col string) (float64, error) {
	switch strings.ToUpper(unit) {
	case "C", "CELSIUS":
		return v, nil
	case "F", "FAHRENHEIT":
		return (v - 32) * 5 / 9, nil
	case "":
		return 0, rowErr("missing_unit", col, "%s has no unit", col)
	}
	return 0, rowErrValue("unknown_unit", col, unit, "%s has unknown unit %q", col, unit)
}

// naraTime reads a time from `<col> (Epoch)`, the instant Nara records. If
// that's blank it falls back to the local wall time in `<col>`
// ("2006-01-02 15:04:05") in the row's time zone. ok is false when both are
// blank.
func (p *naraPlan) naraTime(row *naraRow, col, what string, opts naraOptions) (t time.Time, ok bool, err error) {
	if v := row.get(col + " (Epoch)"); v != "" {
		t, err = naraEpoch(v, what, opts)
		return t, err == nil, err
	}
	v := row.get(col)
	if v == "" {
		return time.Time{}, false, nil
	}
	t, err = time.ParseInLocation("2006-01-02 15:04:05", v, p.zone(row, opts))
	if err != nil {
		return time.Time{}, false, rowErrValue(naraTimeCode("bad", what), col, v, "the %s %q isn't a timestamp", what, v)
	}
	t = t.UTC()
	if t.Before(naraEarliest) || t.After(opts.Now.Add(48*time.Hour)) {
		return time.Time{}, false, rowErrValue(naraTimeCode("implausible", what), col, v, "the %s %q is outside the plausible range", what, v)
	}
	return t, true, nil
}

// naraTimeCode names a timestamp problem for the UI: bad_start_time,
// implausible_end_time and so on.
func naraTimeCode(problem, what string) string {
	return problem + "_" + strings.ReplaceAll(what, " ", "_")
}

// naraEpoch parses an epoch-millisecond timestamp (whole seconds are accepted
// too). A value in scientific notation means a spreadsheet app rewrote the
// file, which fails the whole upload.
func naraEpoch(v, what string, opts naraOptions) (time.Time, error) {
	if v == "" {
		return time.Time{}, rowErr(naraTimeCode("bad", what), "", "the %s is missing", what)
	}
	if strings.ContainsAny(v, "eE") {
		if _, err := strconv.ParseFloat(v, 64); err == nil {
			return time.Time{}, errNaraSpreadsheet
		}
	}
	// Nara writes whole milliseconds; a fraction (seen in its internal data)
	// is dropped.
	whole, _, _ := strings.Cut(v, ".")
	n, err := strconv.ParseInt(whole, 10, 64)
	if err != nil || whole == "" || strings.Count(v, ".") > 1 {
		return time.Time{}, rowErrValue(naraTimeCode("bad", what), "", v, "the %s %q isn't a timestamp", what, v)
	}
	if frac := v[len(whole):]; frac != "" && strings.Trim(frac[1:], "0123456789") != "" {
		return time.Time{}, rowErrValue(naraTimeCode("bad", what), "", v, "the %s %q isn't a timestamp", what, v)
	}
	var t time.Time
	if n > -100_000_000_000 && n < 100_000_000_000 {
		t = time.Unix(n, 0).UTC()
	} else {
		t = time.UnixMilli(n).UTC()
	}
	if t.Before(naraEarliest) || t.After(opts.Now.Add(48*time.Hour)) {
		return time.Time{}, rowErrValue(naraTimeCode("implausible", what), "", v, "the %s %q is outside the plausible range", what, v)
	}
	return t, nil
}

func naraOptionalNumber(v, what string) (*float64, error) {
	if v == "" {
		return nil, nil
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 {
		return nil, rowErrValue("bad_number", what, v, "%s %q isn't a valid number", what, v)
	}
	return &n, nil
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
