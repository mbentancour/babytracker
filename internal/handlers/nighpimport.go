package handlers

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"mime/multipart"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// Baby Tracker (Nighp Software; com.nighp.babytracker_android and its iOS
// twin) exports a zip with one CSV per activity. A baby's files are named
// `<Baby>_<activity>.csv` and start with a `Baby` column; pumping is logged
// for the family, so `pump.csv` has neither. There is no published spec: the
// formats below come from the sample export attached to issue #25.
//
//	<Baby>_sleep.csv      Baby, Time, Duration (min), Note
//	<Baby>_diaper.csv     Baby, Time, Status (Wet / Dirty / Mixed), Note
//	<Baby>_nursing.csv    Baby, Time, Start side, Left duration (min),
//	                      Right Duration (min), Total (min), Note
//	<Baby>_expressed.csv  Baby, Time, Amount (oz.), Note
//	<Baby>_growth.csv     Baby, Time, Length (inches), Weight (lbs.),
//	                      Head Size (inches), Note
//	pump.csv              Time, Start side, Left/Right duration (min),
//	                      Total duration (min), Left/Right/Total amount (oz.),
//	                      Note
//
// Units are named in the header, so they are read from there. Times are local
// wall-clock text with no zone ("6/17/2026 17:15", "7/7/26 11:04 PM"), read in
// the importer's time zone. Whether the day or the month comes first depends
// on the phone's region and isn't recorded, so it is worked out from the
// dates themselves (see nighpDateOrder).
//
// The parsed entries go into a importPlan, so inserting, the summary and the
// issue lists are shared with the Nara import.

type NighpImportHandler struct {
	db  *sqlx.DB
	cfg *config.Config
	now func() time.Time
}

func NewNighpImportHandler(db *sqlx.DB, cfg *config.Config) *NighpImportHandler {
	return &NighpImportHandler{db: db, cfg: cfg, now: time.Now}
}

const (
	// An upload is a zip or loose CSVs. These bound what is read out of it, so
	// a small zip can't expand into something that fills memory.
	nighpMaxFiles      = 100
	nighpMaxFileBytes  = 20 << 20
	nighpMaxTotalBytes = 50 << 20
)

var errNotNighpExport = &importFileError{
	Status: http.StatusBadRequest, Code: "not_nighp_export",
	Message: "these files don't look like a Baby Tracker export",
}

// nighpOptions are the choices specific to this import.
type nighpOptions struct {
	Baby      string // import only this baby's rows; required when the upload holds several
	DateOrder string // "mdy" or "dmy"; "" works it out from the dates
}

// nighpInfo is what was learned about the upload as a whole.
type nighpInfo struct {
	Babies           []string
	DateOrder        string
	DateOrderAssumed bool // no date settled the order; month first was assumed
}

// Preview parses an export without saving anything and reports what an import
// would bring over.
// POST /api/import/nighp-babytracker/preview (multipart: file (repeatable),
// unit_system, timezone, baby, date_order, duplicate_pumping)
func (h *NighpImportHandler) Preview(w http.ResponseWriter, r *http.Request) {
	extendImportDeadlines(w)
	plan, info, opts, ok := h.readUpload(w, r)
	if !ok {
		return
	}
	defer r.MultipartForm.RemoveAll()
	if err := markDuplicatePumps(h.db, plan); err != nil {
		slog.Error("nighp import preview: checking for already imported pumping", "error", err)
		writeImportError(w, http.StatusInternalServerError, "generic", "", "couldn't read the database")
		return
	}
	plan.Duplicates.Included = r.FormValue("duplicate_pumping") == "import"
	if !plan.Duplicates.Included {
		plan.dropDuplicatePumps()
	}
	body := nighpSummary(plan, info, opts)
	body["status"] = "preview"
	pagination.WriteJSON(w, http.StatusOK, body)
}

// Import creates a child from the submitted details and imports a Baby
// Tracker export into it, all in one transaction.
// POST /api/import/nighp-babytracker (multipart: file (repeatable), first_name,
// last_name, birth_date, sex, unit_system, timezone, baby, date_order,
// duplicate_pumping)
func (h *NighpImportHandler) Import(w http.ResponseWriter, r *http.Request) {
	extendImportDeadlines(w)
	ctx, cancel := context.WithTimeout(r.Context(), importTimeout)
	defer cancel()
	plan, info, opts, ok := h.readUpload(w, r)
	if !ok {
		return
	}
	defer r.MultipartForm.RemoveAll()

	child, ok := readImportChild(w, r)
	if !ok {
		return
	}
	includeDuplicates := r.FormValue("duplicate_pumping") == "import"

	childID, err := insertImportPlan(ctx, h.db, child, plan, includeDuplicates)
	if errors.Is(err, errNothingToImport) {
		body := nighpSummary(plan, info, opts)
		body["error"] = "nothing in these files could be imported"
		if plan.Duplicates.Count > 0 && !includeDuplicates {
			body["error"] = "nothing new to import: what's left is pumping already saved for " +
				importNames(plan.Duplicates.Children) + " (send duplicate_pumping=import to import it for this baby too)"
		}
		body["code"] = "nothing_to_import"
		pagination.WriteJSON(w, http.StatusUnprocessableEntity, body)
		return
	}
	if err != nil {
		slog.Error("nighp import failed", "error", err)
		writeImportError(w, http.StatusInternalServerError, "import_failed", "", "import failed; nothing was saved")
		return
	}

	body := nighpSummary(plan, info, opts)
	body["status"] = "completed"
	body["child_id"] = childID
	slog.Info("nighp import completed", "child_id", childID, "stats", body["stats"],
		"skipped", plan.Skipped, "rejected", plan.RejectedCount, "warnings", plan.WarningCount)
	pagination.WriteJSON(w, http.StatusOK, body)
}

func nighpSummary(p *importPlan, info *nighpInfo, opts importOptions) map[string]any {
	body := importSummary(p, opts)
	body["profile"] = p.Profile
	babies := info.Babies
	if babies == nil {
		babies = []string{}
	}
	body["babies"] = babies
	body["date_order"] = info.DateOrder
	body["date_order_assumed"] = info.DateOrderAssumed
	return body
}

// readUpload checks access, reads the uploaded files and parses them. On
// failure it has already written the response. On success the caller must
// RemoveAll the multipart form.
func (h *NighpImportHandler) readUpload(w http.ResponseWriter, r *http.Request) (*importPlan, *nighpInfo, importOptions, bool) {
	opts, ok := readImportForm(w, r, h.cfg, h.now())
	if !ok {
		return nil, nil, importOptions{}, false
	}
	fail := func(err error) (*importPlan, *nighpInfo, importOptions, bool) {
		r.MultipartForm.RemoveAll()
		writeImportFileError(w, err)
		return nil, nil, importOptions{}, false
	}

	bo := nighpOptions{Baby: strings.TrimSpace(r.FormValue("baby"))}
	switch order := r.FormValue("date_order"); order {
	case "", "mdy", "dmy":
		bo.DateOrder = order
	default:
		return fail(&importFileError{Status: http.StatusBadRequest, Code: "invalid_upload", Message: "date_order must be mdy or dmy"})
	}

	files, err := nighpReadFiles(r.MultipartForm.File["file"])
	if err != nil {
		return fail(err)
	}
	plan, info, err := nighpBuildPlan(files, opts, bo)
	if err != nil {
		return fail(err)
	}
	return plan, info, opts, true
}

// --- Reading the upload ---

// nighpFile is one CSV of the export.
type nighpFile struct {
	name   string            // base name, shown with issues
	kind   string            // sleep, diaper, nursing, bottle, growth or pump; "" if not recognised
	milk   string            // a bottle file's feeding type
	header int               // number of header cells
	cols   map[string]int    // header name, lower-cased and without its unit, to column
	units  map[string]string // the same name to the unit its header names, e.g. OZ
	labels map[string]string // the same name to the header as written, for messages
	rows   []nighpRecord
}

type nighpRecord struct {
	record []string
	line   int
}

// nighpReadFiles reads every CSV in the upload: loose CSV files, and the CSVs
// inside any zip.
func nighpReadFiles(uploads []*multipart.FileHeader) ([]*nighpFile, error) {
	if len(uploads) == 0 {
		return nil, &importFileError{Status: http.StatusBadRequest, Code: "invalid_upload", Message: "export file required"}
	}
	var files []*nighpFile
	var total int64
	add := func(name string, src io.Reader) error {
		if len(files) >= nighpMaxFiles {
			return nighpTooBig()
		}
		data, err := io.ReadAll(io.LimitReader(src, nighpMaxFileBytes+1))
		if err != nil {
			return &importFileError{Status: http.StatusBadRequest, Code: "invalid_upload", Message: "the upload couldn't be read"}
		}
		total += int64(len(data))
		if len(data) > nighpMaxFileBytes || total > nighpMaxTotalBytes {
			return nighpTooBig()
		}
		f, err := nighpParseCSV(path.Base(strings.ReplaceAll(name, `\`, "/")), data)
		if err != nil {
			return err
		}
		files = append(files, f)
		return nil
	}

	for _, fh := range uploads {
		src, err := fh.Open()
		if err != nil {
			return nil, &importFileError{Status: http.StatusBadRequest, Code: "invalid_upload", Message: "the upload couldn't be read"}
		}
		err = func() error {
			defer src.Close()
			magic := make([]byte, 4)
			n, _ := io.ReadFull(src, magic)
			if _, err := src.Seek(0, io.SeekStart); err != nil {
				return &importFileError{Status: http.StatusBadRequest, Code: "invalid_upload", Message: "the upload couldn't be read"}
			}
			if n < 4 || !bytes.Equal(magic, []byte("PK\x03\x04")) {
				return add(fh.Filename, src)
			}
			zr, err := zip.NewReader(src, fh.Size)
			if err != nil {
				return &importFileError{Status: http.StatusBadRequest, Code: "bad_zip", Message: "the zip file couldn't be opened"}
			}
			for _, entry := range zr.File {
				base := path.Base(entry.Name)
				// Folders, macOS resource forks and anything that isn't a CSV.
				if entry.FileInfo().IsDir() || strings.HasPrefix(base, ".") || strings.HasPrefix(entry.Name, "__MACOSX/") ||
					!strings.EqualFold(path.Ext(base), ".csv") {
					continue
				}
				rc, err := entry.Open()
				if err != nil {
					return &importFileError{Status: http.StatusBadRequest, Code: "bad_zip", Message: "the zip file couldn't be read"}
				}
				err = add(entry.Name, rc)
				rc.Close()
				if err != nil {
					return err
				}
			}
			return nil
		}()
		if err != nil {
			return nil, err
		}
	}
	return files, nil
}

func nighpTooBig() error {
	limit := strconv.Itoa(nighpMaxTotalBytes >> 20)
	return &importFileError{
		Status: http.StatusRequestEntityTooLarge, Code: "too_large", Detail: limit,
		Message: fmt.Sprintf("the export holds more than %d files or %s MB of data", nighpMaxFiles, limit),
	}
}

var nighpHeaderUnit = regexp.MustCompile(`^(.*?)\s*\(([^)]*)\)\s*$`)

// nighpUnit normalises a header's unit: "oz." to OZ, "inches" to IN, "lbs." to
// LB and so on. Unknown units are returned as written, upper-cased, so the
// conversion can report them.
func nighpUnit(u string) string {
	u = strings.ToUpper(strings.NewReplacer(".", "", " ", "").Replace(u))
	switch u {
	case "OUNCE", "OUNCES", "FLOZ":
		return "OZ"
	case "INCH", "INCHES":
		return "IN"
	case "LBS", "POUND", "POUNDS":
		return "LB"
	case "MINS", "MINUTE", "MINUTES":
		return "MIN"
	}
	return u
}

func nighpParseCSV(name string, data []byte) (*nighpFile, error) {
	// Strip a UTF-8 BOM before the CSV reader sees it: in front of a quoted
	// header cell it would make the reader treat the cell as unquoted.
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
	cr := csv.NewReader(bufio.NewReader(bytes.NewReader(data)))
	cr.FieldsPerRecord = -1 // checked per row, so one bad row doesn't sink the file

	f := &nighpFile{name: name, cols: map[string]int{}, units: map[string]string{}, labels: map[string]string{}}
	header, err := cr.Read()
	if err == io.EOF {
		return f, nil // an empty file: nothing in it, nothing wrong with it
	}
	if err != nil {
		return nil, nighpBadCSV(name, err)
	}
	f.header = len(header)
	for i, h := range header {
		label := strings.TrimSpace(h)
		key, unit := label, ""
		if m := nighpHeaderUnit.FindStringSubmatch(label); m != nil {
			key, unit = m[1], nighpUnit(m[2])
		}
		key = strings.ToLower(strings.Join(strings.Fields(key), " "))
		if key == "" {
			continue
		}
		if _, dup := f.cols[key]; !dup {
			f.cols[key], f.units[key], f.labels[key] = i, unit, label
		}
	}
	for {
		record, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nighpBadCSV(name, err)
		}
		line, _ := cr.FieldPos(0)
		f.rows = append(f.rows, nighpRecord{record: record, line: line})
	}
	f.classify()
	return f, nil
}

func nighpBadCSV(name string, err error) error {
	line := 0
	var pe *csv.ParseError
	if errors.As(err, &pe) {
		line = pe.StartLine
	}
	return &importFileError{
		Status: http.StatusBadRequest, Code: "bad_csv", Detail: strconv.Itoa(line),
		Message: fmt.Sprintf("%s isn't valid CSV near line %d", name, line),
	}
}

// classify works out which activity a file holds from its header, so a
// renamed file still imports. Only bottle files need the name: expressed milk
// and formula share a header.
func (f *nighpFile) classify() {
	has := func(col string) bool { _, ok := f.cols[col]; return ok }
	lower := strings.ToLower(f.name)
	switch {
	case !has("time"):
	case has("status"):
		f.kind = "diaper"
	case has("duration"):
		f.kind = "sleep"
	case has("weight") || has("length") || has("head size"):
		f.kind = "growth"
	case has("total amount") || has("left amount") || has("right amount"):
		f.kind = "pump"
	case has("left duration") || has("right duration"):
		f.kind = "nursing"
	case has("amount") && strings.Contains(lower, "expressed"):
		f.kind, f.milk = "bottle", "breast milk"
	case has("amount") && strings.Contains(lower, "formula"):
		f.kind, f.milk = "bottle", "formula"
	}
}

// --- Building the plan ---

func nighpBlank(record []string) bool {
	for _, v := range record {
		if strings.TrimSpace(v) != "" {
			return false
		}
	}
	return true
}

func nighpBuildPlan(files []*nighpFile, opts importOptions, bo nighpOptions) (*importPlan, *nighpInfo, error) {
	if opts.Location == nil {
		opts.Location = time.UTC
	}
	if opts.Now.IsZero() {
		opts.Now = time.Now()
	}

	recognised := false
	seen := map[string]bool{}
	info := &nighpInfo{}
	for _, f := range files {
		if f.kind == "" {
			continue
		}
		recognised = true
		for _, rec := range f.rows {
			row := &importRow{cols: f.cols, record: rec.record}
			if baby := row.get("baby"); baby != "" && !seen[baby] {
				seen[baby] = true
				info.Babies = append(info.Babies, baby)
			}
		}
	}
	if !recognised {
		return nil, nil, errNotNighpExport
	}
	sort.Strings(info.Babies)
	switch {
	case bo.Baby != "" && !seen[bo.Baby]:
		return nil, nil, &importFileError{
			Status: http.StatusBadRequest, Code: "unknown_baby", Detail: bo.Baby,
			Message: fmt.Sprintf("the export has no entries for %q", bo.Baby),
		}
	case bo.Baby == "" && len(info.Babies) > 1:
		names := strings.Join(info.Babies, ", ")
		return nil, nil, &importFileError{
			Status: http.StatusBadRequest, Code: "multiple_babies", Detail: names,
			Message: "the export holds more than one baby (" + names + "); import one baby at a time",
		}
	}
	baby := bo.Baby
	if baby == "" && len(info.Babies) == 1 {
		baby = info.Babies[0]
	}
	// mine reports whether a row belongs to the baby being imported. Rows
	// with no baby (the family's pumping) belong to every baby.
	mine := func(row *importRow) bool {
		b := row.get("baby")
		return b == "" || b == baby
	}

	order, assumed, err := nighpDateOrder(files, mine, bo.DateOrder)
	if err != nil {
		return nil, nil, err
	}
	info.DateOrder, info.DateOrderAssumed = order, assumed

	p := &importPlan{Skipped: map[string]int{}, AsNotes: map[string]int{}, zones: map[string]*time.Location{}}
	p.Profile.Name = baby
	for _, f := range files {
		for _, rec := range f.rows {
			if nighpBlank(rec.record) {
				continue // spreadsheet apps pad exports with empty rows
			}
			row := &importRow{cols: f.cols, record: rec.record, line: rec.line, typ: f.name}
			if f.kind == "" {
				p.Skipped[f.name]++
				continue
			}
			if !mine(row) {
				continue
			}
			if len(rec.record) != f.header {
				p.reject(importIssue{
					Line: rec.line, Type: f.name, Code: "field_count",
					Detail: strconv.Itoa(f.header), Value: strconv.Itoa(len(rec.record)),
					Reason: fmt.Sprintf("the row has %d columns, the header has %d", len(rec.record), f.header),
				})
				continue
			}
			if err := nighpAddRow(p, f, row, order, opts); err != nil {
				var re *importRowError
				if !errors.As(err, &re) {
					re = &importRowError{Code: "invalid", Reason: err.Error()}
				}
				p.reject(importIssue{Line: rec.line, Type: f.name, Code: re.Code, Detail: re.Detail, Value: re.Value, Reason: re.Reason})
				continue
			}
			if row.repaired {
				p.warn(row, "text_repaired", "", "some text couldn't be read and was replaced")
			}
		}
	}
	return p, info, nil
}

// nighpClock is a wall-clock time as written in the export. For a date that
// isn't year-first, a and b are its first two numbers, in the order written.
type nighpClock struct {
	yearFirst    bool
	a, b, year   int
	hour, minute int
	second       int
}

var nighpTimeText = regexp.MustCompile(`^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4}),?[ T]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?(?: ?([AaPp])\.?[Mm]\.?)?$`)

// nighpParseClock reads "6/17/2026 17:15", "7/7/26 11:04 PM", "17.06.2026 17:15"
// or "2026-06-17 17:15:00".
func nighpParseClock(v string) (nighpClock, bool) {
	// Some locales separate the time and AM/PM with a no-break space.
	v = strings.Join(strings.Fields(strings.NewReplacer(" ", " ", " ", " ").Replace(v)), " ")
	m := nighpTimeText.FindStringSubmatch(v)
	if m == nil {
		return nighpClock{}, false
	}
	n := func(i int) int { x, _ := strconv.Atoi(m[i]); return x }
	c := nighpClock{hour: n(4), minute: n(5), second: n(6)}
	switch {
	case len(m[1]) == 4 && len(m[3]) <= 2:
		c.yearFirst, c.year, c.a, c.b = true, n(1), n(2), n(3)
	case len(m[1]) <= 2 && len(m[3]) == 4:
		c.a, c.b, c.year = n(1), n(2), n(3)
	case len(m[1]) <= 2 && len(m[3]) == 2:
		c.a, c.b, c.year = n(1), n(2), 2000+n(3)
	default:
		return nighpClock{}, false
	}
	if m[7] != "" {
		if c.hour < 1 || c.hour > 12 {
			return nighpClock{}, false
		}
		c.hour %= 12
		if m[7] == "P" || m[7] == "p" {
			c.hour += 12
		}
	}
	if c.hour > 23 || c.minute > 59 || c.second > 59 {
		return nighpClock{}, false
	}
	return c, true
}

// nighpDateOrder decides whether dates are written month first ("mdy") or day
// first ("dmy"). The export doesn't say, but any date whose first or second
// number is over 12 settles it, and an export of more than a few days has
// one. If none does, month first is assumed (the app's home market) and the
// summary says so. Dates pointing both ways mean the files were edited or
// come from different phones, so the upload is refused rather than guessed.
func nighpDateOrder(files []*nighpFile, mine func(*importRow) bool, forced string) (order string, assumed bool, err error) {
	if forced != "" {
		return forced, false, nil
	}
	var monthFirst, dayFirst bool
	for _, f := range files {
		if f.kind == "" {
			continue
		}
		for _, rec := range f.rows {
			row := &importRow{cols: f.cols, record: rec.record}
			if !mine(row) {
				continue
			}
			c, ok := nighpParseClock(row.get("time"))
			if !ok || c.yearFirst || (c.a > 12 && c.b > 12) {
				continue
			}
			if c.a > 12 {
				dayFirst = true
			}
			if c.b > 12 {
				monthFirst = true
			}
		}
	}
	switch {
	case monthFirst && dayFirst:
		return "", false, &importFileError{
			Status: http.StatusBadRequest, Code: "mixed_date_formats",
			Message: "some dates are written month first and others day first; send date_order=mdy or date_order=dmy to say which is right",
		}
	case dayFirst:
		return "dmy", false, nil
	case monthFirst:
		return "mdy", false, nil
	}
	return "mdy", true, nil
}

// nighpTime reads a row's Time in the importer's time zone.
func nighpTime(row *importRow, order string, opts importOptions) (time.Time, error) {
	v := row.get("time")
	if v == "" {
		return time.Time{}, rowErr("bad_start_time", "", "the start time is missing")
	}
	bad := rowErrValue("bad_start_time", "Time", v, "the start time %q isn't a date and time", v)
	c, ok := nighpParseClock(v)
	if !ok {
		return time.Time{}, bad
	}
	month, day := c.a, c.b
	if !c.yearFirst && order == "dmy" {
		day, month = c.a, c.b
	}
	if month < 1 || month > 12 || day < 1 || day > 31 {
		return time.Time{}, bad
	}
	t := time.Date(c.year, time.Month(month), day, c.hour, c.minute, c.second, 0, opts.Location)
	// time.Date rolls a day that doesn't exist (31 June) into the next month.
	if t.Day() != day || int(t.Month()) != month {
		return time.Time{}, bad
	}
	t = t.UTC()
	if t.Before(importEarliest) || t.After(opts.Now.Add(48*time.Hour)) {
		return time.Time{}, rowErrValue("implausible_start_time", "Time", v, "the start time %q is outside the plausible range", v)
	}
	return t, nil
}

// nighpMinutes reads a minutes column ("" is zero).
func nighpMinutes(f *nighpFile, row *importRow, col string) (time.Duration, bool, error) {
	mins, err := optionalNumber(row.get(col), f.label(col))
	if err != nil || mins == nil {
		return 0, false, err
	}
	if *mins > importMaxDuration.Minutes() {
		return 0, false, rowErr("too_long", "", "lasts longer than 24 hours")
	}
	return time.Duration(math.Round(*mins*60)) * time.Second, true, nil
}

// label is a column's header as written, for messages.
func (f *nighpFile) label(col string) string {
	if l, ok := f.labels[col]; ok {
		return l
	}
	return col
}

func nighpVolume(f *nighpFile, row *importRow, col string, opts importOptions) (*float64, error) {
	v, err := optionalNumber(row.get(col), f.label(col))
	if err != nil || v == nil {
		return nil, err
	}
	return convertVolume(*v, f.units[col], f.label(col), opts)
}

func nighpAddRow(p *importPlan, f *nighpFile, row *importRow, order string, opts importOptions) error {
	start, err := nighpTime(row, order, opts)
	if err != nil {
		return err
	}
	note := row.get("note")

	switch f.kind {
	case "sleep":
		d, ok, err := nighpMinutes(f, row, "duration")
		if err != nil {
			return err
		}
		if !ok {
			return rowErr("no_end_time", "", "no end time or duration")
		}
		if d == 0 {
			return rowErr("zero_length", "", "the sleep ends when it starts")
		}
		end := start.Add(d)
		p.Sleep = append(p.Sleep, importSleep{Start: start, End: end, Nap: importIsNap(start, end, opts.Location), Notes: note})

	case "diaper":
		status := row.get("status")
		c := importChange{Time: start, Notes: note}
		switch strings.ToLower(status) {
		case "wet":
			c.Wet = true
		case "dirty":
			c.Solid = true
		case "mixed":
			c.Wet, c.Solid = true, true
		case "dry":
			// BabyTracker diapers are wet and/or solid; a dry check is kept
			// as a note rather than shown as a wet diaper.
			p.note(start, joinNotes("Dry diaper", note))
			p.AsNotes["Dry diaper"]++
			return nil
		case "":
			return rowErr("missing_diaper_type", "", "no diaper type recorded")
		default:
			return rowErrValue("unknown_diaper_type", f.label("status"), status, "unrecognized diaper type %q", status)
		}
		p.Changes = append(p.Changes, c)

	case "nursing":
		l, _, err := nighpMinutes(f, row, "left duration")
		if err != nil {
			return err
		}
		r, _, err := nighpMinutes(f, row, "right duration")
		if err != nil {
			return err
		}
		total, _, err := nighpMinutes(f, row, "total")
		if err != nil {
			return err
		}
		length := l + r
		if length == 0 {
			length = total
		}
		if length > importMaxDuration {
			return rowErr("too_long", "", "lasts longer than 24 hours")
		}
		side := feedingSide(row.get("start side"))
		feed := importFeeding{Start: start, End: start.Add(length), Type: "breast milk", Notes: note}
		switch {
		case (l > 0 && r > 0) || (l == 0 && r == 0 && side == "both"):
			feed.Method = "both breasts"
		case l > 0 || (r == 0 && side == "left"):
			feed.Method = "left breast"
		case r > 0 || side == "right":
			feed.Method = "right breast"
		default:
			if length == 0 && note == "" {
				return rowErr("empty_entry", "", "nothing recorded in this entry")
			}
			feed.Method = "both breasts"
			feed.Notes = joinNotes("Side not recorded in Baby Tracker", note)
			p.warn(row, "side_unknown", "", "no side or duration recorded; imported as both breasts")
		}
		p.Feedings = append(p.Feedings, feed)

	case "bottle":
		amount, err := nighpVolume(f, row, "amount", opts)
		if err != nil {
			return err
		}
		if amount == nil && note == "" {
			return rowErr("empty_entry", "", "nothing recorded in this entry")
		}
		p.Feedings = append(p.Feedings, importFeeding{Start: start, End: start, Type: f.milk, Method: "bottle", Amount: amount, Notes: note})

	case "growth":
		return nighpAddGrowth(p, f, row, start, note, opts)

	case "pump":
		return nighpAddPump(p, f, row, start, note, opts)
	}
	return nil
}

func nighpAddGrowth(p *importPlan, f *nighpFile, row *importRow, at time.Time, note string, opts importOptions) error {
	date := at.In(opts.Location).Format("2006-01-02")
	imperial := opts.UnitSystem == "imperial"

	weight, err := optionalNumber(row.get("weight"), f.label("weight"))
	if err != nil {
		return err
	}
	height, err := optionalNumber(row.get("length"), f.label("length"))
	if err != nil {
		return err
	}
	head, err := optionalNumber(row.get("head size"), f.label("head size"))
	if err != nil {
		return err
	}
	if weight == nil && height == nil && head == nil {
		return rowErr("no_measurements", "", "no weight, height, or head size")
	}

	// Validate every value before appending anything, so a bad row adds
	// nothing. Rounded as the Nara import does, to what the edit forms accept.
	var w, h, hd float64
	if weight != nil {
		kg, err := toKg(*weight, f.units["weight"], f.label("weight"))
		if err != nil {
			return err
		}
		if kg <= 0 || kg > importMaxWeightKg {
			return rowErr("out_of_range", f.label("weight"), "the weight is implausible")
		}
		w = roundTo(kg, 2)
		if imperial {
			w = roundTo(kg/kgPerLb, 2)
		}
	}
	length := func(v float64, col string, max float64) (float64, error) {
		cm, err := toCm(v, f.units[col], f.label(col))
		if err != nil {
			return 0, err
		}
		if cm <= 0 || cm > max {
			return 0, rowErr("out_of_range", f.label(col), "%s is implausible", f.label(col))
		}
		if imperial {
			return roundTo(cm/cmPerIn, 1), nil
		}
		return roundTo(cm, 1), nil
	}
	if height != nil {
		if h, err = length(*height, "length", importMaxHeightCm); err != nil {
			return err
		}
	}
	if head != nil {
		if hd, err = length(*head, "head size", importMaxHeadCm); err != nil {
			return err
		}
	}
	if weight != nil {
		p.Weight = append(p.Weight, importMeasurement{Date: date, Value: w, Notes: note})
	}
	if height != nil {
		p.Height = append(p.Height, importMeasurement{Date: date, Value: h, Notes: note})
	}
	if head != nil {
		p.HeadCirc = append(p.HeadCirc, importMeasurement{Date: date, Value: hd, Notes: note})
	}
	return nil
}

func nighpAddPump(p *importPlan, f *nighpFile, row *importRow, start time.Time, note string, opts importOptions) error {
	left, err := nighpVolume(f, row, "left amount", opts)
	if err != nil {
		return err
	}
	right, err := nighpVolume(f, row, "right amount", opts)
	if err != nil {
		return err
	}
	total, err := nighpVolume(f, row, "total amount", opts)
	if err != nil {
		return err
	}
	// The session's length is its total; both sides are usually pumped at
	// once, so the sides are only added up when there is no total.
	length, ok, err := nighpMinutes(f, row, "total duration")
	if err != nil {
		return err
	}
	if !ok || length == 0 {
		l, _, err := nighpMinutes(f, row, "left duration")
		if err != nil {
			return err
		}
		r, _, err := nighpMinutes(f, row, "right duration")
		if err != nil {
			return err
		}
		length = l + r
	}
	if length > importMaxDuration {
		return rowErr("too_long", "", "lasts longer than 24 hours")
	}

	// pump.csv has no Baby column: pumping is logged for the family. Marking
	// it so lets a sibling's import leave out sessions already saved.
	pm := importPumping{Start: start, End: start.Add(length), Family: row.get("baby") == ""}
	var sides float64
	if left != nil {
		sides += *left
	}
	if right != nil {
		sides += *right
	}
	switch {
	case total != nil && *total > 0:
		pm.Amount = total
	case sides > 0:
		v := roundVolume(sides, opts.UnitSystem)
		if v > volumeLimit(opts.UnitSystem) {
			return rowErr("out_of_range", f.label("left amount")+" + "+f.label("right amount"), "the left and right amounts add up to an implausible amount")
		}
		pm.Amount = &v
	case total != nil:
		pm.Amount = total
	case left != nil || right != nil:
		pm.Amount = &sides // explicit zeros
	}
	if pm.Amount == nil && pm.End.Equal(pm.Start) {
		// Nothing measured: keep a note if there is one.
		if note == "" {
			return rowErr("empty_entry", "", "nothing recorded in this entry")
		}
		p.note(start, "Pumping: "+note)
		p.AsNotes["Pump"]++
		return nil
	}
	pm.Note = note
	p.Pumping = append(p.Pumping, pm)
	return nil
}
