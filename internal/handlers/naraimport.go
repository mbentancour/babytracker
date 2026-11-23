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

	"github.com/jmoiron/sqlx"
	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/pagination"
)

// Nara Baby publishes no export spec. Column names follow the header in
// jarnskeggi/BabyWise (NaraSchema.kt, MIT), copied from a real export. Values
// follow what other open-source importers report from real exports, or their
// synthetic samples where that's all there is. An export is one CSV per
// child: a `Type` column per row, epoch-millisecond timestamps with an IANA
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

var errNotNaraExport = &importFileError{
	Status: http.StatusBadRequest, Code: "not_nara_export",
	Message: "this file doesn't look like a Nara Baby export",
}

// errNaraSpreadsheet is returned for an epoch a spreadsheet app has
// rewritten in scientific notation (1.78998E+12), which loses up to ±83
// minutes. Every row in such a file is affected, so the file is refused.
var errNaraSpreadsheet = &importFileError{
	Status: http.StatusBadRequest, Code: "spreadsheet_rounded",
	Message: "the timestamps in this file were rounded by a spreadsheet app; export again from Nara and upload that file without opening it in a spreadsheet",
}

// Preview parses an export without saving anything and reports what an
// import would bring over, plus the baby's details from the profile row.
// POST /api/import/nara/preview (multipart: file, unit_system, timezone,
// duplicate_pumping)
func (h *NaraImportHandler) Preview(w http.ResponseWriter, r *http.Request) {
	extendImportDeadlines(w)
	plan, opts, ok := h.readUpload(w, r)
	if !ok {
		return
	}
	defer r.MultipartForm.RemoveAll()
	if err := markDuplicatePumps(h.db, plan); err != nil {
		slog.Error("nara preview: checking for already imported pumping", "error", err)
		writeImportError(w, http.StatusInternalServerError, "generic", "", "couldn't read the database")
		return
	}
	plan.Duplicates.Included = r.FormValue("duplicate_pumping") == "import"
	if !plan.Duplicates.Included {
		plan.dropDuplicatePumps()
	}
	body := importSummary(plan, opts)
	body["status"] = "preview"
	body["profile"] = plan.Profile
	pagination.WriteJSON(w, http.StatusOK, body)
}

// Import creates a child from the submitted details and imports a Nara Baby
// CSV export into it, all in one transaction.
// POST /api/import/nara (multipart: file, first_name, last_name, birth_date,
// sex, unit_system, timezone, duplicate_pumping)
func (h *NaraImportHandler) Import(w http.ResponseWriter, r *http.Request) {
	extendImportDeadlines(w)
	ctx, cancel := context.WithTimeout(r.Context(), importTimeout)
	defer cancel()
	plan, opts, ok := h.readUpload(w, r)
	if !ok {
		return
	}
	defer r.MultipartForm.RemoveAll()

	child, ok := readImportChild(w, r)
	if !ok {
		return
	}
	// Family pumping that's already in BabyTracker (from a sibling's export,
	// or an earlier import of this baby) is skipped unless the user chose to
	// import it for this baby too.
	includeDuplicates := r.FormValue("duplicate_pumping") == "import"

	childID, err := insertImportPlan(ctx, h.db, child, plan, includeDuplicates)
	if errors.Is(err, errNothingToImport) {
		// No empty child: on first run that would end onboarding with
		// nothing imported and nowhere to retry.
		body := importSummary(plan, opts)
		body["error"] = "nothing in this file could be imported"
		if plan.Duplicates.Count > 0 && !includeDuplicates {
			body["error"] = "nothing new to import: what's left is family pumping already saved for " +
				importNames(plan.Duplicates.Children) + " (send duplicate_pumping=import to import it for this baby too)"
		}
		body["code"] = "nothing_to_import"
		pagination.WriteJSON(w, http.StatusUnprocessableEntity, body)
		return
	}
	if err != nil {
		slog.Error("nara import failed", "error", err)
		writeImportError(w, http.StatusInternalServerError, "import_failed", "", "import failed; nothing was saved")
		return
	}

	body := importSummary(plan, opts)
	body["status"] = "completed"
	body["child_id"] = childID
	slog.Info("nara import completed", "child_id", childID, "stats", body["stats"],
		"skipped", plan.Skipped, "rejected", plan.RejectedCount, "warnings", plan.WarningCount)
	pagination.WriteJSON(w, http.StatusOK, body)
}

// readUpload checks access, reads the multipart upload and parses the export.
// On failure it has already written the response. On success the caller must
// RemoveAll the multipart form.
func (h *NaraImportHandler) readUpload(w http.ResponseWriter, r *http.Request) (*importPlan, importOptions, bool) {
	opts, ok := readImportForm(w, r, h.cfg, h.now())
	if !ok {
		return nil, importOptions{}, false
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		r.MultipartForm.RemoveAll()
		writeImportError(w, http.StatusBadRequest, "invalid_upload", "", "export file required")
		return nil, importOptions{}, false
	}
	defer file.Close()

	plan, err := parseNaraExport(file, opts)
	if err != nil {
		r.MultipartForm.RemoveAll()
		writeImportFileError(w, err)
		return nil, importOptions{}, false
	}
	return plan, opts, true
}

// zone returns the row's own time zone (Nara records one per row, and it
// changes when the family travels), falling back to the importer's.
func (p *importPlan) zone(row *importRow, opts importOptions) *time.Location {
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

// --- Parsing ---

func parseNaraExport(src io.Reader, opts importOptions) (*importPlan, error) {
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

	p := &importPlan{Skipped: map[string]int{}, AsNotes: map[string]int{}, zones: map[string]*time.Location{}}
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
			return nil, &importFileError{
				Status: http.StatusBadRequest, Code: "bad_csv", Detail: strconv.Itoa(line),
				Message: fmt.Sprintf("the file isn't valid CSV near line %d", line),
			}
		}
		line, _ := cr.FieldPos(0)
		row := &importRow{cols: cols, record: record, line: line}
		row.typ = row.get("Type")
		switch {
		case row.typ == "":
			continue
		case row.typ == "Profile":
			p.addProfile(row)
			continue
		case len(record) != len(header):
			p.reject(importIssue{
				Line: line, Type: row.typ, Code: "field_count",
				Detail: strconv.Itoa(len(header)), Value: strconv.Itoa(len(record)),
				Reason: fmt.Sprintf("the row has %d columns, the header has %d", len(record), len(header)),
			})
			continue
		}

		if err := p.addRow(row, opts); err != nil {
			if errors.Is(err, errNaraSpreadsheet) {
				return nil, errNaraSpreadsheet
			}
			var re *importRowError
			if !errors.As(err, &re) {
				re = &importRowError{Code: "invalid", Reason: err.Error()}
			}
			p.reject(importIssue{Line: line, Type: row.typ, Code: re.Code, Detail: re.Detail, Value: re.Value, Reason: re.Reason})
			continue
		}
		if row.repaired {
			p.warn(row, "text_repaired", "", "some text couldn't be read and was replaced")
		}
	}
	return p, nil
}

func (p *importPlan) addProfile(row *importRow) {
	// Skip profiles typed as something other than CHILD. A blank Type is
	// still taken: one importer says a parent's export leaves it blank, but
	// that's unverified, and the details it fills in can be edited anyway.
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

func (p *importPlan) addRow(row *importRow, opts importOptions) error {
	switch row.typ {
	case "Breastfeed", "Bottle Feed", "Combo Feed", "Solid Feed", "Diaper", "Pump", "Sleep",
		"Growth", "Medical", "Milestone", "Baby First", "Routine", "Vaccine":
	default:
		// "Postpartum ..." types are reportedly from a parent's export (one
		// importer says so; unverified). They aren't the baby's, so not even
		// their notes are kept.
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
		var bottles []importFeeding
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
		if pm.Amount == nil && pm.End.Equal(pm.Start) {
			// No amount and no length: nothing was measured (or the timer
			// was still running when the export was made). A note is kept.
			if note == "" {
				return rowErr("empty_entry", "", "nothing recorded in this entry")
			}
			p.note(start, "Pumping: "+note)
			p.AsNotes["Pump"]++
			return nil
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
		p.Sleep = append(p.Sleep, importSleep{Start: start, End: end, Nap: importIsNap(start, end, p.zone(row, opts)), Notes: note})

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
		p.Milestones = append(p.Milestones, importMilestone{
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

func naraBreastfeed(row *importRow, prefix string, start time.Time) (importFeeding, bool, error) {
	l, err := naraDuration(row, "["+prefix+"] Left Duration (Seconds)")
	if err != nil {
		return importFeeding{}, false, err
	}
	r, err := naraDuration(row, "["+prefix+"] Right Duration (Seconds)")
	if err != nil {
		return importFeeding{}, false, err
	}
	if l+r > importMaxDuration {
		return importFeeding{}, false, rowErr("too_long", "", "lasts longer than 24 hours")
	}
	begin := feedingSide(row.get("[" + prefix + "] Begin Side"))
	end := feedingSide(row.get("[" + prefix + "] End Side"))

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
	return importFeeding{Start: start, End: start.Add(l + r), Type: "breast milk", Method: method}, has, nil
}

// naraHasBottle reports whether a row records anything about a bottle.
func naraHasBottle(row *importRow, prefix string) bool {
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
func (p *importPlan) naraBottle(row *importRow, prefix string, start time.Time, opts importOptions) ([]importFeeding, error) {
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
	unit := importUnitLabels(opts.UnitSystem)["volume"]
	brand := row.get(col("Formula Name"))
	formulaNote := ""
	if brand != "" {
		formulaNote = "Formula: " + brand
	}
	feeding := func(typ string, amount *float64, notes string) importFeeding {
		return importFeeding{Start: start, End: start, Type: typ, Method: "bottle", Amount: amount, Notes: notes}
	}

	mixed := func(b, f *float64, extra string) []importFeeding {
		split := fmt.Sprintf("Mixed bottle: %s %s breast milk + %s %s formula", formatAmount(*b), unit, formatAmount(*f), unit)
		return []importFeeding{
			feeding("breast milk", b, joinNotes(split, extra)),
			feeding("formula", f, joinNotes(split, extra, formulaNote)),
		}
	}
	switch {
	case positive(bm) && positive(formula):
		return mixed(bm, formula, ""), nil
	case (positive(bm) || positive(formula)) && hasBM && hasFormula:
		// A mixed bottle with one share recorded. A larger generic Volume is
		// taken as the total (likely, but unverified), so the other share is
		// the difference. A gap under 1 mL is rounding between two columns'
		// units, not a share.
		have := bm
		if positive(formula) {
			have = formula
		}
		minShare := 1.0 // mL
		if opts.UnitSystem == "imperial" {
			minShare /= mlPerFlOz
		}
		if positive(total) && *total-*have >= minShare {
			other := roundVolume(*total-*have, opts.UnitSystem)
			p.warn(row, "mixed_derived", "", "mixed bottle with one share recorded; the other share is the total minus that share")
			if have == bm {
				return mixed(bm, &other, "formula share worked out from the total"), nil
			}
			return mixed(&other, formula, "breast milk share worked out from the total"), nil
		}
		p.warn(row, "mixed_partial", "", "mixed bottle with only one share recorded")
		if have == bm {
			return []importFeeding{feeding("breast milk", bm, joinNotes("Mixed bottle; only the breast milk share recorded in Nara", formulaNote))}, nil
		}
		return []importFeeding{feeding("formula", formula, joinNotes("Mixed bottle; only the formula share recorded in Nara", formulaNote))}, nil
	case positive(bm):
		return []importFeeding{feeding("breast milk", bm, "")}, nil
	case positive(formula):
		return []importFeeding{feeding("formula", formula, formulaNote)}, nil
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
		return []importFeeding{feeding("formula", amount, formulaNote)}, nil
	case hasBM && !hasFormula:
		return []importFeeding{feeding("breast milk", amount, "")}, nil
	case hasBM && hasFormula:
		p.warn(row, "mixed_no_split", "", "mixed bottle with no breast milk/formula split; imported as breast milk")
		return []importFeeding{feeding("breast milk", amount, joinNotes("Mixed bottle (breast milk + formula), split not recorded in Nara", formulaNote))}, nil
	default:
		p.warn(row, "milk_type_unknown", "", "milk type not recorded; imported as breast milk")
		return []importFeeding{feeding("breast milk", amount, joinNotes("Milk type not recorded in Nara", formulaNote))}, nil
	}
}

// naraFoodTag matches Nara's tagged solid food lines, e.g.
// "Cereal: amountKey=ALL; preparationKeyz=PUREE".
var naraFoodTag = regexp.MustCompile(`^([^:]+):\s*(\w+=.*)$`)

// naraFoodTagNames labels the tag keys seen in a real export (amountKey,
// preparationKeyz) or only in a sample (foodCategoryKey).
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

func naraSolid(row *importRow, start time.Time) (importFeeding, error) {
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
	return importFeeding{Start: start, End: start, Type: "solid food", Method: "parent fed", Notes: strings.Join(notes, "; ")}, nil
}

// changes.color only accepts these; anything else goes into the notes.
var naraChangeColors = map[string]bool{"black": true, "brown": true, "green": true, "yellow": true}

var naraTextures = map[string]string{
	"RUN": "runny", "MUCOUS": "mucousy", "MUSH": "mushy", "SOLID": "solid", "PEBBLE": "pebbles",
}

// naraDiaper maps a diaper row. dry reports a dry check (neither wet nor
// dirty), which the caller keeps as a note.
func naraDiaper(row *importRow, at time.Time) (c importChange, dry bool, err error) {
	kind := strings.ToLower(row.get("[Diaper] Type"))
	wet := strings.Contains(kind, "wet")
	dirty := strings.Contains(kind, "dirty")
	dry = strings.Contains(kind, "dry") && !wet && !dirty
	if kind == "" {
		return importChange{}, false, rowErr("missing_diaper_type", "", "no diaper type recorded")
	}
	if !wet && !dirty && !dry {
		return importChange{}, false, rowErrValue("unknown_diaper_type", "[Diaper] Type", row.get("[Diaper] Type"),
			"unrecognized diaper type %q", row.get("[Diaper] Type"))
	}
	c = importChange{Time: at, Wet: wet, Solid: dirty}

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

func (p *importPlan) naraPump(row *importRow, start time.Time, opts importOptions) (importPumping, error) {
	left, err := naraVolume(row, "[Pump] Left Volume", opts)
	if err != nil {
		return importPumping{}, err
	}
	right, err := naraVolume(row, "[Pump] Right Volume", opts)
	if err != nil {
		return importPumping{}, err
	}
	total, err := naraVolume(row, "[Pump] Total Volume", opts)
	if err != nil {
		return importPumping{}, err
	}
	end, err := p.naraEnd(row, "Pump", start, opts)
	if err != nil {
		return importPumping{}, err
	}

	// Pumping is logged for the family, so a pump row can have no profile.
	family := row.get("_profileKey") == "" || row.get("Profile Name") == ""
	pm := importPumping{Start: start, End: end, Family: family}
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
		// Each side passed naraVolume's limit on its own; their sum must too.
		v := roundVolume(sides, opts.UnitSystem)
		if v > volumeLimit(opts.UnitSystem) {
			return importPumping{}, rowErr("out_of_range", "[Pump] Left Volume + [Pump] Right Volume", "the left and right volumes add up to an implausible amount")
		}
		pm.Amount = &v
	case total != nil:
		pm.Amount = total
	case left != nil || right != nil:
		pm.Amount = &sides // explicit zeros
	}
	return pm, nil
}

// naraEnd reads `[T] End Date/time (Epoch)`, falling back to the local
// `[T] End Date/time`, then to `[T] Duration (Seconds)`, then to the start
// time.
func (p *importPlan) naraEnd(row *importRow, prefix string, start time.Time, opts importOptions) (time.Time, error) {
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
	if end.Sub(start) > importMaxDuration {
		return time.Time{}, rowErr("too_long", "", "lasts longer than 24 hours")
	}
	return end, nil
}

// naraDuration reads a seconds column, rejecting values over a day before
// they can overflow time.Duration.
func naraDuration(row *importRow, col string) (time.Duration, error) {
	secs, err := optionalNumber(row.get(col), col)
	if err != nil || secs == nil {
		return 0, err
	}
	if *secs > importMaxDuration.Seconds() {
		return 0, rowErr("too_long", "", "lasts longer than 24 hours")
	}
	return time.Duration(math.Round(*secs)) * time.Second, nil
}

func (p *importPlan) addGrowth(row *importRow, at time.Time, note string, opts importOptions) error {
	date := at.In(p.zone(row, opts)).Format("2006-01-02")
	imperial := opts.UnitSystem == "imperial"

	weight, err := optionalNumber(row.get("[Growth] Weight"), "[Growth] Weight")
	if err != nil {
		return err
	}
	height, err := optionalNumber(row.get("[Growth] Height"), "[Growth] Height")
	if err != nil {
		return err
	}
	head, err := optionalNumber(row.get("[Growth] Head Size"), "[Growth] Head Size")
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
		kg, err := toKg(*weight, row.get("[Growth] Weight Unit"), "[Growth] Weight")
		if err != nil {
			return err
		}
		if kg <= 0 || kg > importMaxWeightKg {
			return rowErr("out_of_range", "[Growth] Weight", "the weight is implausible")
		}
		w = roundTo(kg, 2)
		if imperial {
			w = roundTo(kg/kgPerLb, 2)
		}
	}
	length := func(v float64, col string, max float64) (float64, error) {
		cm, err := toCm(v, row.get(col+" Unit"), col)
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
		if h, err = length(*height, "[Growth] Height", importMaxHeightCm); err != nil {
			return err
		}
	}
	if head != nil {
		if hd, err = length(*head, "[Growth] Head Size", importMaxHeadCm); err != nil {
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

// naraMedicationDose splits Nara's medication text, e.g.
// "Children's Tylenol, 3.75 (ML)", into name, dose and unit.
var naraMedicationDose = regexp.MustCompile(`^(.+?),\s*([0-9]+(?:[.,][0-9]+)?)\s*\(([^)]+)\)$`)

func (p *importPlan) addMedical(row *importRow, at time.Time, note string, opts importOptions) error {
	// Read everything before appending, so a bad value rejects the whole row
	// rather than leaving half of it imported.
	// An entry may list several medicines, one per line (reported by another
	// importer; unverified).
	var meds []importMedication
	for _, line := range strings.Split(row.get("[Medical] Medication"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		m := importMedication{Time: at, Name: line}
		if parts := naraMedicationDose.FindStringSubmatch(line); parts != nil {
			m.Name, m.Dosage, m.DosageUnit = strings.TrimSpace(parts[1]), parts[2], strings.ToLower(parts[3])
		}
		if len(meds) == 0 {
			m.Notes = note
		}
		meds = append(meds, m)
	}
	var temp *importTemperature
	tempValue, err := optionalNumber(row.get("[Medical] Temperature"), "[Medical] Temperature")
	if err != nil {
		return err
	}
	if tempValue != nil {
		c, err := toCelsius(*tempValue, row.get("[Medical] Temperature Unit"), "[Medical] Temperature")
		if err != nil {
			return err
		}
		if c < importMinTempC || c > importMaxTempC {
			return rowErr("out_of_range", "[Medical] Temperature", "the temperature is implausible")
		}
		v := roundTo(c, 1)
		if opts.UnitSystem == "imperial" {
			v = roundTo(c*9/5+32, 1)
		}
		temp = &importTemperature{Time: at, Value: v, Notes: note}
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

// naraVolume reads a volume column and its "<col> Unit" companion, converting
// to the import's volume unit (mL for metric, fl oz for imperial).
func naraVolume(row *importRow, col string, opts importOptions) (*float64, error) {
	v, err := optionalNumber(row.get(col), col)
	if err != nil || v == nil {
		return nil, err
	}
	return convertVolume(*v, row.get(col+" Unit"), col, opts)
}

// naraTime reads a time from `<col> (Epoch)`, the instant Nara records. If
// that's blank it falls back to the local wall time in `<col>`
// ("2006-01-02 15:04:05") in the row's time zone. ok is false when both are
// blank.
func (p *importPlan) naraTime(row *importRow, col, what string, opts importOptions) (t time.Time, ok bool, err error) {
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
	if t.Before(importEarliest) || t.After(opts.Now.Add(48*time.Hour)) {
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
func naraEpoch(v, what string, opts importOptions) (time.Time, error) {
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
	if t.Before(importEarliest) || t.After(opts.Now.Add(48*time.Hour)) {
		return time.Time{}, rowErrValue(naraTimeCode("implausible", what), "", v, "the %s %q is outside the plausible range", what, v)
	}
	return t, nil
}
