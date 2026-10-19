package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/middleware"
)

// naraHeader holds every column the importer reads, grouped as in Nara's
// export. Real exports only include the groups for row types present, in
// varying order (see naraSparseHeader), so the parser looks columns up by
// name.
var naraHeader = []string{
	"Type", "Profile Name", "Start Date/time", "Start Date/time (Epoch)", "Created By Caregiver",
	"Last Updated By Caregiver", "Note", "Time Zone",
	"[Sleep] Duration (Seconds)", "[Sleep] End Date/time", "[Sleep] End Date/time (Epoch)",
	"[Growth] Head Size", "[Growth] Head Size Unit", "[Growth] Height", "[Growth] Height Unit",
	"[Growth] Weight", "[Growth] Weight Unit",
	"[Diaper] Type", "[Diaper] Detail", "[Diaper] Dirty Color", "[Diaper] Dirty Texture",
	"[Medical] Medication", "[Medical] Temperature", "[Medical] Temperature Unit",
	"[Breastfeed] Begin Side", "[Breastfeed] End Side",
	"[Breastfeed] Left Duration (Seconds)", "[Breastfeed] Right Duration (Seconds)",
	"[Bottle Feed] Type", "[Bottle Feed] Breast Milk Volume", "[Bottle Feed] Breast Milk Volume Unit",
	"[Bottle Feed] Formula Name", "[Bottle Feed] Formula Volume", "[Bottle Feed] Formula Volume Unit",
	"[Bottle Feed] Volume", "[Bottle Feed] Volume Unit",
	"[Baby First] Baby First",
	"[Combo Feed] Begin Side", "[Combo Feed] End Side",
	"[Combo Feed] Left Duration (Seconds)", "[Combo Feed] Right Duration (Seconds)",
	"[Combo Feed] Type", "[Combo Feed] Breast Milk Volume", "[Combo Feed] Breast Milk Volume Unit",
	"[Combo Feed] Formula Name", "[Combo Feed] Formula Volume", "[Combo Feed] Formula Volume Unit",
	"[Combo Feed] Volume", "[Combo Feed] Volume Unit",
	"[Solid Feed] Food", "[Solid Feed] Meal",
	"[Milestone] Milestone",
	"[Routine] Routine",
	"[Vaccine] Vaccine",
	"[Pump] Duration (Seconds)", "[Pump] End Date/time", "[Pump] End Date/time (Epoch)",
	"[Pump] Left Volume", "[Pump] Left Volume Unit", "[Pump] Right Volume", "[Pump] Right Volume Unit",
	"[Pump] Total Volume", "[Pump] Total Volume Unit",
	"[Profile] Birth Date", "[Profile] Birth Date (Adjusted)", "[Profile] Sex", "[Profile] Type",
	"_familyKey", "_profileKey", "_activityKey",
}

// naraSparseHeader is shaped like a real export with only diaper and sleep
// rows: the envelope, those two groups, the profile group and the keys.
var naraSparseHeader = []string{
	"Type", "Profile Name", "Start Date/time", "Start Date/time (Epoch)", "Created By Caregiver",
	"Last Updated By Caregiver", "Note", "Time Zone",
	"[Diaper] Type", "[Diaper] Detail", "[Diaper] Dirty Color", "[Diaper] Dirty Texture",
	"[Sleep] Duration (Seconds)", "[Sleep] End Date/time", "[Sleep] End Date/time (Epoch)",
	"[Profile] Birth Date", "[Profile] Birth Date (Adjusted)", "[Profile] Sex", "[Profile] Type",
	"_familyKey", "_profileKey", "_activityKey",
}

// nrow is one export row, as column -> value.
type nrow map[string]string

// naraExport renders rows with a UTF-8 BOM (some exports appear to start
// with one) and every cell quoted, quotes doubled. A row of Type "Profile"
// written as the last row is one cell short, like Nara's profile footer. It
// fails the test if a row names a column the header lacks, so a typo can't
// silently produce an empty field.
func naraExport(t *testing.T, header []string, rows ...nrow) string {
	t.Helper()
	known := make(map[string]bool, len(header))
	for _, h := range header {
		known[h] = true
	}
	quote := func(v string) string { return `"` + strings.ReplaceAll(v, `"`, `""`) + `"` }
	var b strings.Builder
	b.WriteString("\uFEFF")
	line := func(cells []string) {
		q := make([]string, len(cells))
		for i, c := range cells {
			q[i] = quote(c)
		}
		b.WriteString(strings.Join(q, ",") + "\r\n")
	}
	line(header)
	for i, r := range rows {
		for k := range r {
			if !known[k] {
				t.Fatalf("row uses column %q, which the header doesn't have", k)
			}
		}
		cells := make([]string, len(header))
		for j, h := range header {
			cells[j] = r[h]
		}
		if r["Type"] == "Profile" && i == len(rows)-1 {
			cells = cells[:len(cells)-1]
		}
		line(cells)
	}
	return b.String()
}

// 2026-09-16T17:00:53Z
const naraT0 = "1789578053000"

var naraNow = time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)

func naraOpts(units string) naraOptions {
	return naraOptions{UnitSystem: units, Location: time.UTC, Now: naraNow}
}

func parseNara(t *testing.T, csv string, opts naraOptions) *naraPlan {
	t.Helper()
	p, err := parseNaraExport(strings.NewReader(csv), opts)
	if err != nil {
		t.Fatalf("parseNaraExport: %v", err)
	}
	return p
}

// one parses a single row, failing on any rejection.
func one(t *testing.T, r nrow, units string) *naraPlan {
	t.Helper()
	p := parseNara(t, naraExport(t, naraHeader, r), naraOpts(units))
	if p.RejectedCount != 0 {
		t.Fatalf("unexpected rejection: %+v", p.Rejected)
	}
	return p
}

// rejected parses a single row that must be rejected and returns the issue.
func rejected(t *testing.T, r nrow) naraIssue {
	t.Helper()
	p := parseNara(t, naraExport(t, naraHeader, r), naraOpts("metric"))
	if p.RejectedCount != 1 || p.total() != 0 {
		t.Fatalf("want one rejected row and nothing imported, got rejected=%+v stats=%v", p.Rejected, p.stats())
	}
	return p.Rejected[0]
}

// at returns s[i], failing the test instead of panicking when it's missing,
// so one regression doesn't abort the rest of the package's tests.
func at[T any](t *testing.T, s []T, i int) T {
	t.Helper()
	if i >= len(s) {
		t.Fatalf("want at least %d entries, got %d: %+v", i+1, len(s), s)
	}
	return s[i]
}

func amount(t *testing.T, v *float64) float64 {
	t.Helper()
	if v == nil {
		t.Fatal("amount is nil")
	}
	return *v
}

// row builds a row of the given type starting at naraT0, from column/value
// pairs.
func row(typ string, kv ...string) nrow {
	r := nrow{"Type": typ, "Start Date/time (Epoch)": naraT0}
	for i := 0; i+1 < len(kv); i += 2 {
		r[kv[i]] = kv[i+1]
	}
	return r
}

func warningCodes(p *naraPlan) []string {
	var codes []string
	for _, w := range p.Warnings {
		codes = append(codes, w.Code)
	}
	return codes
}

func noteTexts(p *naraPlan) []string {
	var notes []string
	for _, n := range p.Notes {
		notes = append(notes, n.Note)
	}
	return notes
}

// --- File-level handling ---

func TestNaraRejectsOtherCSVs(t *testing.T) {
	for name, csv := range map[string]string{
		"no Type column":    "date,amount\n2026-01-01,5\n",
		"Type but no epoch": "Type,Start,Duration\nSleep,2026-01-01 08:00,3600\n", // e.g. a Huckleberry export
		"empty file":        "",
	} {
		if _, err := parseNaraExport(strings.NewReader(csv), naraOpts("metric")); err != errNotNaraExport {
			t.Errorf("%s: got %v, want errNotNaraExport", name, err)
		}
	}
}

func TestNaraHeaderWithAndWithoutBOM(t *testing.T) {
	quoted := naraExport(t, naraHeader, row("Diaper", "[Diaper] Type", "Wet"))
	for name, csv := range map[string]string{
		"BOM + quoted header":   quoted,
		"no BOM":                strings.TrimPrefix(quoted, "\uFEFF"),
		"LF line endings":       strings.ReplaceAll(quoted, "\r\n", "\n"),
		"trailing blank line":   quoted + "\r\n",
		"BOM + unquoted header": "\uFEFFType,Start Date/time (Epoch),[Diaper] Type\nDiaper," + naraT0 + ",Wet\n",
		"padded header names":   "Type , Start Date/time (Epoch) ,[Diaper] Type\nDiaper," + naraT0 + ",Wet\n",
	} {
		p, err := parseNaraExport(strings.NewReader(csv), naraOpts("metric"))
		if err != nil || len(p.Changes) != 1 {
			t.Errorf("%s: err=%v plan=%+v", name, err, p)
		}
	}
}

func TestNaraRealisticSparseExport(t *testing.T) {
	// A header with only the groups present and the short profile footer
	// last, as real exports have.
	p := parseNara(t, naraExport(t, naraSparseHeader,
		nrow{"Type": "Diaper", "Profile Name": "Theo", "Start Date/time (Epoch)": naraT0, "Time Zone": "America/Toronto",
			"[Diaper] Type": "Dirty", "[Diaper] Dirty Color": "GREEN YELLOW", "_profileKey": "c-1", "_activityKey": "t-1"},
		nrow{"Type": "", "Note": "a stray blank-typed row is ignored"},
		nrow{"Type": "Sleep", "Profile Name": "Theo", "Start Date/time (Epoch)": naraT0, "Time Zone": "America/Toronto",
			"[Sleep] Duration (Seconds)": "3600", "_profileKey": "c-1", "_activityKey": "t-2"},
		nrow{"Type": "Profile", "Profile Name": "Theo", "[Profile] Birth Date": "2026-07-01", "[Profile] Sex": "MALE",
			"[Profile] Type": "CHILD", "_profileKey": "c-1"},
	), naraOpts("metric"))
	if p.RejectedCount != 0 || len(p.Changes) != 1 || len(p.Sleep) != 1 {
		t.Fatalf("rejected %+v changes %d sleep %d", p.Rejected, len(p.Changes), len(p.Sleep))
	}
	if want := (naraProfile{Name: "Theo", BirthDate: "2026-07-01", Sex: "male"}); p.Profile != want {
		t.Errorf("profile = %+v, want %+v", p.Profile, want)
	}
}

func TestNaraSpreadsheetRoundedEpochsRefuseTheFile(t *testing.T) {
	// Excel writes 13-digit epochs as 1.78998E+12, moving every time by up to
	// ±83 minutes; that must not import quietly.
	csv := naraExport(t, naraHeader,
		row("Diaper", "[Diaper] Type", "Wet"),
		nrow{"Type": "Diaper", "Start Date/time (Epoch)": "1.78998E+12", "[Diaper] Type": "Wet"},
	)
	if _, err := parseNaraExport(strings.NewReader(csv), naraOpts("metric")); err != errNaraSpreadsheet {
		t.Fatalf("got %v, want errNaraSpreadsheet", err)
	}
}

func TestNaraBadQuoteFailsTheFileWithTheRowsLine(t *testing.T) {
	for name, c := range map[string]struct {
		csv  string
		line string
	}{
		"bare quote mid-field": {"Type,Start Date/time (Epoch),Note\n" +
			"Diaper," + naraT0 + ",fine\n" +
			"Diaper," + naraT0 + ",a \"stray\" quote\n" +
			"Diaper," + naraT0 + ",never read\n", "3"},
		// A field that opens a quote and never closes it swallows the rest of
		// the file; the error must point at the row it starts on.
		"unclosed quote": {"Type,Start Date/time (Epoch),Note\n" +
			"Diaper," + naraT0 + ",\"never closed\n" +
			"Diaper," + naraT0 + ",x\n" +
			"Diaper," + naraT0 + ",y\n", "2"},
	} {
		_, err := parseNaraExport(strings.NewReader(c.csv), naraOpts("metric"))
		var fe *naraFileError
		if !errors.As(err, &fe) || fe.Code != "bad_csv" || fe.Detail != c.line {
			t.Errorf("%s: got %#v, want bad_csv on line %s", name, err, c.line)
		}
	}
}

func TestNaraRowWithWrongColumnCountIsRejected(t *testing.T) {
	csv := "Type,Start Date/time (Epoch),[Diaper] Type\n" +
		"Diaper," + naraT0 + ",Wet\n" +
		"Diaper," + naraT0 + "\n" +
		"Profile,x\n" // the profile footer can be short; it isn't an entry
	p := parseNara(t, csv, naraOpts("metric"))
	r := at(t, p.Rejected, 0)
	if len(p.Changes) != 1 || p.RejectedCount != 1 || r.Code != "field_count" || r.Line != 3 || r.Value != "2" || r.Detail != "3" {
		t.Fatalf("changes=%d rejected=%+v", len(p.Changes), p.Rejected)
	}
}

func TestNaraLineNumbersCountPhysicalLines(t *testing.T) {
	p := parseNara(t, naraExport(t, naraHeader,
		row("Diaper", "[Diaper] Type", "Wet", "Note", "first line\nsecond line"),
		row("Diaper", "[Diaper] Type", "Sparkly"),
	), naraOpts("metric"))
	// The header is line 1 and the two-line note spans 2-3, so the bad row
	// starts on line 4.
	if r := at(t, p.Rejected, 0); r.Line != 4 {
		t.Fatalf("rejected=%+v, want line 4", p.Rejected)
	}
}

func TestNaraIssuesAreCappedInMemory(t *testing.T) {
	rows := []nrow{row("Diaper", "[Diaper] Type", "Wet")}
	for i := 0; i < naraIssueCap+25; i++ {
		rows = append(rows, row("Diaper", "[Diaper] Type", "Sparkly"), row("Bottle Feed", "[Bottle Feed] Volume", "60", "[Bottle Feed] Volume Unit", "ML"))
	}
	p := parseNara(t, naraExport(t, naraHeader, rows...), naraOpts("metric"))
	if len(p.Rejected) != naraIssueCap || p.RejectedCount != naraIssueCap+25 ||
		len(p.Warnings) != naraIssueCap || p.WarningCount != naraIssueCap+25 {
		t.Errorf("rejected %d/%d warnings %d/%d", len(p.Rejected), p.RejectedCount, len(p.Warnings), p.WarningCount)
	}
}

func TestNaraRejectedRowKeepsNoWarnings(t *testing.T) {
	// Rows rejected while being read leave no warnings behind.
	r := rejected(t, row("Combo Feed", "[Combo Feed] Type", "Formula", "[Combo Feed] Formula Volume", "60", "[Combo Feed] Formula Volume Unit", "CUPS"))
	if r.Code != "unknown_unit" {
		t.Errorf("code %q", r.Code)
	}
	p := parseNara(t, naraExport(t, naraHeader, row("Bottle Feed", "[Bottle Feed] Volume", "60", "[Bottle Feed] Volume Unit", "LITRES")), naraOpts("metric"))
	if p.WarningCount != 0 || len(p.Warnings) != 0 {
		t.Errorf("warnings %v on a rejected row", warningCodes(p))
	}
}

func TestNaraRepairsTextPostgresCantStore(t *testing.T) {
	p := one(t, row("Diaper", "[Diaper] Type", "Wet", "Note", "caf\xe9 \x00ok"), "metric")
	if got := at(t, p.Changes, 0).Notes; got != "caf\uFFFD ok" {
		t.Errorf("notes = %q", got)
	}
	if codes := warningCodes(p); len(codes) != 1 || codes[0] != "text_repaired" {
		t.Errorf("warnings = %v", codes)
	}
}

func TestNaraProfileRow(t *testing.T) {
	p := parseNara(t, naraExport(t, naraHeader,
		nrow{"Type": "Profile", "Profile Name": "Parent", "[Profile] Type": "PARENT", "[Profile] Birth Date": "1990-01-01"},
		nrow{"Type": "Profile", "Profile Name": "Rosa", "[Profile] Type": "CHILD", "[Profile] Birth Date": "2026-08-09", "[Profile] Sex": "FEMALE"},
		nrow{"Type": "Profile", "Profile Name": "Second", "[Profile] Type": "CHILD", "[Profile] Birth Date": "2025-01-01"},
		row("Diaper", "[Diaper] Type", "Wet"),
	), naraOpts("metric"))
	if want := (naraProfile{Name: "Rosa", BirthDate: "2026-08-09", Sex: "female"}); p.Profile != want {
		t.Errorf("profile = %+v, want %+v (the first child profile wins)", p.Profile, want)
	}
	if len(p.Skipped)+p.RejectedCount != 0 {
		t.Errorf("profile rows should be neither skipped nor rejected: %v %v", p.Skipped, p.Rejected)
	}
}

// --- Timestamps and limits ---

func TestNaraTimestamps(t *testing.T) {
	want := time.Date(2026, 9, 16, 17, 0, 53, 0, time.UTC)
	for _, v := range []string{naraT0, "1789578053", "1789578053000.5"} {
		if p := one(t, nrow{"Type": "Diaper", "Start Date/time (Epoch)": v, "[Diaper] Type": "Wet"}, "metric"); !at(t, p.Changes, 0).Time.Equal(want) {
			t.Errorf("epoch %q = %v, want %v", v, p.Changes[0].Time, want)
		}
	}
	for v, code := range map[string]string{
		"":                "bad_start_time",
		"soon":            "bad_start_time",
		"1.2.3":           "bad_start_time",
		"17895.x":         "bad_start_time",
		"NaN":             "bad_start_time",
		"0":               "implausible_start_time",
		"-5000":           "implausible_start_time",
		"99999999999999":  "implausible_start_time",
		"946684799999":    "implausible_start_time", // a millisecond before 2000
		"1789750853000.0": "",                       // a whole-millisecond decimal is fine
	} {
		r := nrow{"Type": "Diaper", "Start Date/time (Epoch)": v, "[Diaper] Type": "Wet"}
		if code == "" {
			one(t, r, "metric")
			continue
		}
		if got := rejected(t, r); got.Code != code {
			t.Errorf("epoch %q: code %q, want %q", v, got.Code, code)
		}
	}
	if got := rejected(t, row("Pump", "[Pump] End Date/time (Epoch)", "later", "[Pump] Total Volume", "50", "[Pump] Total Volume Unit", "ML")); got.Code != "bad_end_time" || got.Value != "later" {
		t.Errorf("bad end time: %+v", got)
	}
}

func TestNaraFallsBackToLocalTimesWhenEpochsAreBlank(t *testing.T) {
	// 08:00 in Copenhagen (CEST) is 06:00 UTC.
	p := one(t, nrow{"Type": "Sleep", "Start Date/time": "2026-09-20 08:00:00", "Time Zone": "Europe/Copenhagen",
		"[Sleep] End Date/time": "2026-09-20 09:30:00"}, "metric")
	s := at(t, p.Sleep, 0)
	if want := time.Date(2026, 9, 20, 6, 0, 0, 0, time.UTC); !s.Start.Equal(want) || s.End.Sub(s.Start) != 90*time.Minute {
		t.Errorf("sleep %v-%v", s.Start, s.End)
	}
	if got := rejected(t, nrow{"Type": "Diaper", "Start Date/time": "9/20/2026 8:00", "[Diaper] Type": "Wet"}); got.Code != "bad_start_time" {
		t.Errorf("spreadsheet-formatted local time: %+v", got)
	}
}

func TestNaraRejectsAbsurdValuesWithoutOverflow(t *testing.T) {
	for name, c := range map[string]struct {
		r    nrow
		code string
	}{
		// 1e12 seconds overflows time.Duration if it's converted before the
		// cap is checked.
		"feed duration":   {row("Breastfeed", "[Breastfeed] Left Duration (Seconds)", "1e12"), "too_long"},
		"split durations": {row("Breastfeed", "[Breastfeed] Left Duration (Seconds)", "50000", "[Breastfeed] Right Duration (Seconds)", "50000"), "too_long"},
		"sleep duration":  {row("Sleep", "[Sleep] Duration (Seconds)", "100000"), "too_long"},
		"pump end":        {row("Pump", "[Pump] End Date/time (Epoch)", "1789750853000"), "too_long"},
		"bottle volume":   {row("Bottle Feed", "[Bottle Feed] Type", "Formula", "[Bottle Feed] Formula Volume", "1e308", "[Bottle Feed] Formula Volume Unit", "FLOZ"), "out_of_range"},
		"pump total":      {row("Pump", "[Pump] Total Volume", "40", "[Pump] Total Volume Unit", "FLOZ"), "out_of_range"},
		"weight":          {row("Growth", "[Growth] Weight", "400", "[Growth] Weight Unit", "KG"), "out_of_range"},
		"zero height":     {row("Growth", "[Growth] Height", "0", "[Growth] Height Unit", "CM"), "out_of_range"},
		"temperature":     {row("Medical", "[Medical] Temperature", "60", "[Medical] Temperature Unit", "C"), "out_of_range"},
		"cold reading":    {row("Medical", "[Medical] Temperature", "80", "[Medical] Temperature Unit", "F"), "out_of_range"},
		"negative number": {row("Pump", "[Pump] Left Volume", "-5", "[Pump] Left Volume Unit", "ML"), "bad_number"},
	} {
		if got := rejected(t, c.r); got.Code != c.code {
			t.Errorf("%s: code %q, want %q", name, got.Code, c.code)
		}
	}
}

// --- Feeds ---

func TestNaraBreastfeed(t *testing.T) {
	cases := []struct {
		name       string
		r          nrow
		method     string
		minutes    float64
		warn       bool
		noteSuffix string
	}{
		{"both timed", row("Breastfeed", "[Breastfeed] Begin Side", "LEFT", "[Breastfeed] End Side", "RIGHT",
			"[Breastfeed] Left Duration (Seconds)", "600", "[Breastfeed] Right Duration (Seconds)", "300", "Note", "sleepy"),
			"both breasts", 15, false, "sleepy"},
		{"left timed only", row("Breastfeed", "[Breastfeed] Left Duration (Seconds)", "480"), "left breast", 8, false, ""},
		{"right timed, left zero", row("Breastfeed", "[Breastfeed] Left Duration (Seconds)", "0", "[Breastfeed] Right Duration (Seconds)", "90.4"), "right breast", 1.5, false, ""},
		{"untimed, sides differ", row("Breastfeed", "[Breastfeed] Begin Side", "LEFT", "[Breastfeed] End Side", "RIGHT.nonTimer"),
			"both breasts", 0, false, ""},
		{"untimed, end side only", row("Breastfeed", "[Breastfeed] End Side", "Right.NonTimer"), "right breast", 0, false, ""},
		{"untimed, begin side only", row("Breastfeed", "[Breastfeed] Begin Side", "LEFT"), "left breast", 0, false, ""},
		{"untimed, same side", row("Breastfeed", "[Breastfeed] Begin Side", "LEFT", "[Breastfeed] End Side", "LEFT.nonTimer"),
			"left breast", 0, false, ""},
		{"nothing recorded", row("Breastfeed", "Note", "night feed"), "both breasts", 0, true, "Side not recorded in Nara; night feed"},
	}
	for _, c := range cases {
		p := one(t, c.r, "metric")
		if len(p.Feedings) != 1 {
			t.Fatalf("%s: feedings=%d", c.name, len(p.Feedings))
		}
		f := p.Feedings[0]
		if f.Method != c.method || f.Type != "breast milk" || f.End.Sub(f.Start).Minutes() != c.minutes {
			t.Errorf("%s: got %s, %v", c.name, f.Method, f.End.Sub(f.Start))
		}
		if got := len(p.Warnings) == 1 && p.Warnings[0].Code == "side_unknown"; got != c.warn {
			t.Errorf("%s: warnings %v", c.name, warningCodes(p))
		}
		if !strings.HasSuffix(f.Notes, c.noteSuffix) {
			t.Errorf("%s: notes %q", c.name, f.Notes)
		}
	}
}

func TestNaraBottle(t *testing.T) {
	type want struct {
		typ, notes string
		amount     float64 // -1 for no amount
	}
	cases := []struct {
		name     string
		r        nrow
		units    string
		feedings []want
		warnings []string
	}{
		{"formula", row("Bottle Feed", "[Bottle Feed] Type", "Formula", "[Bottle Feed] Formula Name", "Good Start",
			"[Bottle Feed] Formula Volume", "45", "[Bottle Feed] Formula Volume Unit", "ML"), "metric",
			[]want{{"formula", "Formula: Good Start", 45}}, nil},
		{"breast milk", row("Bottle Feed", "[Bottle Feed] Type", "Breast Milk",
			"[Bottle Feed] Breast Milk Volume", "2", "[Bottle Feed] Breast Milk Volume Unit", "FLOZ"), "metric",
			[]want{{"breast milk", "", 59.1}}, nil},
		{"formula with no volume", row("Bottle Feed", "[Bottle Feed] Type", "Formula"), "metric",
			[]want{{"formula", "", -1}}, nil},
		{"mixed with a split becomes two feedings", row("Bottle Feed", "[Bottle Feed] Type", "Breast Milk Formula",
			"[Bottle Feed] Breast Milk Volume", "1", "[Bottle Feed] Breast Milk Volume Unit", "FLOZ", "[Bottle Feed] Formula Name", "Kendamil",
			"[Bottle Feed] Formula Volume", "60", "[Bottle Feed] Formula Volume Unit", "ML", "Note", "top-up"), "metric",
			[]want{
				{"breast milk", "Mixed bottle: 29.6 mL breast milk + 60 mL formula; top-up", 29.6},
				{"formula", "Mixed bottle: 29.6 mL breast milk + 60 mL formula; Formula: Kendamil; top-up", 60},
			}, nil},
		{"mixed with one share and a larger total", row("Bottle Feed", "[Bottle Feed] Type", "Breast Milk Formula",
			"[Bottle Feed] Breast Milk Volume", "60", "[Bottle Feed] Breast Milk Volume Unit", "ML",
			"[Bottle Feed] Volume", "4", "[Bottle Feed] Volume Unit", "FLOZ"), "metric",
			[]want{
				{"breast milk", "Mixed bottle: 60 mL breast milk + 58.3 mL formula; formula share worked out from the total", 60},
				{"formula", "Mixed bottle: 60 mL breast milk + 58.3 mL formula; formula share worked out from the total", 58.3},
			}, []string{"mixed_derived"}},
		{"mixed with only one share", row("Bottle Feed", "[Bottle Feed] Type", "Breast Milk Formula",
			"[Bottle Feed] Formula Volume", "3", "[Bottle Feed] Formula Volume Unit", "FLOZ", "[Bottle Feed] Formula Name", "Enfamil"), "imperial",
			[]want{{"formula", "Mixed bottle; only the formula share recorded in Nara; Formula: Enfamil", 3}}, []string{"mixed_partial"}},
		{"generic volume typed by the Type column", row("Bottle Feed", "[Bottle Feed] Type", "Formula", "[Bottle Feed] Volume", "4", "[Bottle Feed] Volume Unit", "OZ"), "imperial",
			[]want{{"formula", "", 4}}, nil},
		{"zero formula volume falls back to the total", row("Bottle Feed", "[Bottle Feed] Type", "Formula", "[Bottle Feed] Formula Volume", "0",
			"[Bottle Feed] Formula Volume Unit", "ML", "[Bottle Feed] Volume", "90", "[Bottle Feed] Volume Unit", "ML"), "metric",
			[]want{{"formula", "", 90}}, nil},
		{"a formula name means formula", row("Bottle Feed", "[Bottle Feed] Formula Name", "Similac", "[Bottle Feed] Volume", "90", "[Bottle Feed] Volume Unit", "ML"), "metric",
			[]want{{"formula", "Formula: Similac", 90}}, nil},
		{"no milk type is flagged", row("Bottle Feed", "[Bottle Feed] Volume", "120", "[Bottle Feed] Volume Unit", "ML"), "metric",
			[]want{{"breast milk", "Milk type not recorded in Nara", 120}}, []string{"milk_type_unknown"}},
		{"mixed without a split is flagged", row("Bottle Feed", "[Bottle Feed] Type", "Breast Milk Formula", "[Bottle Feed] Volume", "100", "[Bottle Feed] Volume Unit", "ML"), "metric",
			[]want{{"breast milk", "Mixed bottle (breast milk + formula), split not recorded in Nara", 100}}, []string{"mixed_no_split"}},
	}
	for _, c := range cases {
		p := one(t, c.r, c.units)
		if len(p.Feedings) != len(c.feedings) {
			t.Errorf("%s: feedings %+v", c.name, p.Feedings)
			continue
		}
		for i, w := range c.feedings {
			f := p.Feedings[i]
			got := -1.0
			if f.Amount != nil {
				got = *f.Amount
			}
			if f.Type != w.typ || f.Method != "bottle" || f.Notes != w.notes || got != w.amount || !f.Start.Equal(f.End) {
				t.Errorf("%s: feeding %d = %s %v %q, want %s %v %q", c.name, i, f.Type, got, f.Notes, w.typ, w.amount, w.notes)
			}
		}
		if got := warningCodes(p); strings.Join(got, ",") != strings.Join(c.warnings, ",") {
			t.Errorf("%s: warnings %v, want %v", c.name, got, c.warnings)
		}
	}

	for name, c := range map[string]struct {
		r    nrow
		code string
	}{
		"volume without a unit": {row("Bottle Feed", "[Bottle Feed] Type", "Formula", "[Bottle Feed] Formula Volume", "4"), "missing_unit"},
		"unknown unit":          {row("Bottle Feed", "[Bottle Feed] Type", "Formula", "[Bottle Feed] Formula Volume", "4", "[Bottle Feed] Formula Volume Unit", "CUPS"), "unknown_unit"},
	} {
		got := rejected(t, c.r)
		if got.Code != c.code || got.Detail != "[Bottle Feed] Formula Volume" {
			t.Errorf("%s: %+v", name, got)
		}
		if c.code == "unknown_unit" && got.Value != "CUPS" {
			t.Errorf("%s: value %q", name, got.Value)
		}
	}
}

func TestNaraComboFeed(t *testing.T) {
	t.Run("breast and bottle", func(t *testing.T) {
		p := one(t, row("Combo Feed", "[Combo Feed] Begin Side", "RIGHT", "[Combo Feed] Right Duration (Seconds)", "300",
			"[Combo Feed] Type", "Breast Milk", "[Combo Feed] Volume", "2", "[Combo Feed] Volume Unit", "FLOZ", "Note", "fussy"), "metric")
		breast, bottle := at(t, p.Feedings, 0), at(t, p.Feedings, 1)
		if len(p.Feedings) != 2 || breast.Method != "right breast" || breast.End.Sub(breast.Start) != 5*time.Minute || breast.Notes != "fussy" ||
			bottle.Method != "bottle" || bottle.Type != "breast milk" || amount(t, bottle.Amount) != 59.1 || bottle.Notes != "fussy" {
			t.Errorf("got %+v", p.Feedings)
		}
	})
	t.Run("breast only adds no empty bottle", func(t *testing.T) {
		p := one(t, row("Combo Feed", "[Combo Feed] Begin Side", "LEFT", "[Combo Feed] Left Duration (Seconds)", "240"), "metric")
		if len(p.Feedings) != 1 || at(t, p.Feedings, 0).Method != "left breast" {
			t.Errorf("got %+v", p.Feedings)
		}
	})
	t.Run("bottle only adds no empty breastfeed", func(t *testing.T) {
		p := one(t, row("Combo Feed", "[Combo Feed] Type", "Formula", "[Combo Feed] Formula Volume", "60", "[Combo Feed] Formula Volume Unit", "ML"), "metric")
		if len(p.Feedings) != 1 || at(t, p.Feedings, 0).Type != "formula" {
			t.Errorf("got %+v", p.Feedings)
		}
	})
	t.Run("empty", func(t *testing.T) {
		if got := rejected(t, row("Combo Feed")); got.Code != "empty_entry" {
			t.Errorf("code %q", got.Code)
		}
	})
}

func TestNaraSolidFeed(t *testing.T) {
	p := one(t, row("Solid Feed", "[Solid Feed] Food", "Applesauce\nCereal: amountKey=ALL; preparationKeyz=PUREE\nMoong Dal: amountKey=SOME; foodCategoryKey=PROTEIN; textureKey=LUMPY",
		"[Solid Feed] Meal", "LUNCH", "Note", "loved it"), "metric")
	f := at(t, p.Feedings, 0)
	if f.Type != "solid food" || f.Method != "parent fed" || f.Amount != nil || p.SolidFeeds != 1 {
		t.Errorf("got %+v (solid feeds %d)", f, p.SolidFeeds)
	}
	want := "Food: Applesauce, Cereal (amount: all, preparation: puree), Moong Dal (amount: some, category: protein, texture: lumpy); Meal: lunch; loved it"
	if f.Notes != want {
		t.Errorf("notes %q\nwant  %q", f.Notes, want)
	}
}

// --- Diapers, pumping, sleep ---

func TestNaraDiaper(t *testing.T) {
	p := one(t, row("Diaper", "[Diaper] Type", "Dirty Wet", "[Diaper] Detail", "Rash Blowout",
		"[Diaper] Dirty Color", "RED YELLOW", "[Diaper] Dirty Texture", "MUSH RUN"), "metric")
	if c := at(t, p.Changes, 0); !c.Wet || !c.Solid || c.Color != "yellow" || c.Notes != "Texture: mushy, runny; Also: red; Rash; Blowout" {
		t.Errorf("got %+v", c)
	}
	p = one(t, row("Diaper", "[Diaper] Type", "Dirty", "[Diaper] Dirty Color", "GRAY"), "metric")
	if c := at(t, p.Changes, 0); c.Color != "" || c.Notes != "Color: gray" || c.Wet || !c.Solid {
		t.Errorf("unsupported color: %+v", c)
	}

	// BabyTracker diapers are wet and/or solid, and the UI labels anything
	// else "wet", so a dry check is kept as a note instead.
	p = one(t, row("Diaper", "[Diaper] Type", "Dry", "Note", "checked"), "metric")
	if len(p.Changes) != 0 || strings.Join(noteTexts(p), "|") != "Dry diaper; checked" || p.AsNotes["Dry diaper"] != 1 {
		t.Errorf("changes=%+v notes=%v asNotes=%v", p.Changes, noteTexts(p), p.AsNotes)
	}

	if got := rejected(t, row("Diaper", "[Diaper] Type", "Sparkly")); got.Code != "unknown_diaper_type" || got.Value != "Sparkly" {
		t.Errorf("unknown type: %+v", got)
	}
	if got := rejected(t, row("Diaper")); got.Code != "missing_diaper_type" {
		t.Errorf("empty type: %+v", got)
	}
}

func TestNaraPump(t *testing.T) {
	cases := []struct {
		name    string
		r       nrow
		units   string
		amount  float64 // -1 for no amount
		minutes float64
	}{
		{"sides with end time", row("Pump", "[Pump] End Date/time (Epoch)", "1789579433000",
			"[Pump] Left Volume", "2", "[Pump] Left Volume Unit", "FLOZ", "[Pump] Right Volume", "70", "[Pump] Right Volume Unit", "ML"), "metric", 129.1, 23},
		{"end epoch wins over the duration", row("Pump", "[Pump] End Date/time (Epoch)", "1789579433000", "[Pump] Duration (Seconds)", "60",
			"[Pump] Total Volume", "50", "[Pump] Total Volume Unit", "ML"), "metric", 50, 23},
		{"total only, duration", row("Pump", "[Pump] Duration (Seconds)", "600", "[Pump] Total Volume", "100", "[Pump] Total Volume Unit", "ML"), "metric", 100, 10},
		{"zero sides and a total", row("Pump", "[Pump] Left Volume", "0", "[Pump] Left Volume Unit", "ML",
			"[Pump] Right Volume", "0", "[Pump] Right Volume Unit", "ML", "[Pump] Total Volume", "90", "[Pump] Total Volume Unit", "ML"), "metric", 90, 0},
		{"Nara's total wins over the sides", row("Pump", "[Pump] Left Volume", "2", "[Pump] Left Volume Unit", "FLOZ", "[Pump] Right Volume", "2.1", "[Pump] Right Volume Unit", "FLOZ",
			"[Pump] Total Volume", "4", "[Pump] Total Volume Unit", "FLOZ"), "imperial", 4, 0},
		{"explicit zero total", row("Pump", "[Pump] Total Volume", "0", "[Pump] Total Volume Unit", "ML"), "metric", 0, 0},
		{"duration but no amount", row("Pump", "[Pump] Duration (Seconds)", "900"), "metric", -1, 15},
		{"imperial rounding", row("Pump", "[Pump] Total Volume", "100", "[Pump] Total Volume Unit", "ML"), "imperial", 3.38, 0},
	}
	for _, c := range cases {
		pm := at(t, one(t, c.r, c.units).Pumping, 0)
		got := -1.0
		if pm.Amount != nil {
			got = *pm.Amount
		}
		if got != c.amount || pm.End.Sub(pm.Start).Minutes() != c.minutes {
			t.Errorf("%s: amount %v, %v", c.name, got, pm.End.Sub(pm.Start))
		}
	}

	p := one(t, row("Pump", "Note", "evening", "[Pump] Total Volume", "4", "[Pump] Total Volume Unit", "FLOZ"), "imperial")
	if pm := at(t, p.Pumping, 0); pm.Note != "evening" || p.stats()["notes"] != 1 || !pm.Family {
		t.Errorf("pumping %+v stats %v", p.Pumping, p.stats())
	}
	p = one(t, row("Pump", "Profile Name", "Rosa", "_profileKey", "c-1", "[Pump] Total Volume", "4", "[Pump] Total Volume Unit", "FLOZ"), "imperial")
	if at(t, p.Pumping, 0).Family {
		t.Error("a pump row with a profile is the child's, not the family's")
	}
	if got := rejected(t, row("Pump", "[Pump] End Date/time (Epoch)", "1789570000000")); got.Code != "end_before_start" {
		t.Errorf("end before start: %+v", got)
	}
	if got := rejected(t, row("Pump")); got.Code != "empty_entry" {
		t.Errorf("empty pump: %+v", got)
	}
}

func TestNaraSleep(t *testing.T) {
	// 17:00:53 UTC is 19:00:53 in Copenhagen (CEST) and 10:00:53 in Vancouver.
	night := one(t, row("Sleep", "Time Zone", "Europe/Copenhagen", "[Sleep] End Date/time (Epoch)", "1789585253000", "Note", "white noise"), "metric")
	if s := at(t, night.Sleep, 0); s.Nap || s.End.Sub(s.Start) != 2*time.Hour || s.Notes != "white noise" {
		t.Errorf("night: %+v", s)
	}
	nap := one(t, row("Sleep", "Time Zone", "America/Vancouver", "[Sleep] Duration (Seconds)", "5400"), "metric")
	if s := at(t, nap.Sleep, 0); !s.Nap || s.End.Sub(s.Start) != 90*time.Minute {
		t.Errorf("nap: %+v", s)
	}
	if got := rejected(t, row("Sleep")); got.Code != "no_end_time" {
		t.Errorf("no end: %q", got.Code)
	}
	if got := rejected(t, row("Sleep", "[Sleep] End Date/time (Epoch)", naraT0)); got.Code != "zero_length" {
		t.Errorf("zero length: %q", got.Code)
	}
}

func TestNaraNapBoundaries(t *testing.T) {
	day := time.Date(2026, 9, 16, 0, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		start time.Time
		d     time.Duration
		nap   bool
	}{
		{day.Add(6*time.Hour + 59*time.Minute), time.Hour, false},
		{day.Add(7 * time.Hour), time.Hour, true},
		{day.Add(18*time.Hour + 59*time.Minute), time.Hour, true},
		{day.Add(19 * time.Hour), time.Hour, false},
		{day.Add(12 * time.Hour), 4*time.Hour - time.Minute, true},
		{day.Add(12 * time.Hour), 4 * time.Hour, false},
	} {
		if got := naraIsNap(c.start, c.start.Add(c.d), time.UTC); got != c.nap {
			t.Errorf("start %s for %v: nap=%v, want %v", c.start.Format("15:04"), c.d, got, c.nap)
		}
	}
}

// --- Growth and medical ---

func TestNaraGrowthUnitsAndRounding(t *testing.T) {
	// Values are rounded to what the edit forms accept: 0.01 for weight, 0.1
	// for lengths.
	cases := []struct {
		units, w, wu, h, hu string
		weight, height      float64
	}{
		{"metric", "9.80625", "LB", "55", "CM", 4.45, 55},
		{"metric", "4200", "G", "550", "MM", 4.2, 55},
		{"metric", "160", "OZ", "21.65", "IN", 4.54, 55},
		{"imperial", "4.2", "KG", "55", "CM", 9.26, 21.7},
		{"imperial", "12.5", "LBS", "24", "IN", 12.5, 24},
	}
	for _, c := range cases {
		p := one(t, row("Growth", "[Growth] Weight", c.w, "[Growth] Weight Unit", c.wu, "[Growth] Height", c.h, "[Growth] Height Unit", c.hu, "Note", "checkup"), c.units)
		w, h := at(t, p.Weight, 0), at(t, p.Height, 0)
		if w.Value != c.weight || h.Value != c.height || len(p.HeadCirc) != 0 || w.Notes != "checkup" || h.Notes != "checkup" {
			t.Errorf("%s %s%s %s%s: weight %+v height %+v", c.units, c.w, c.wu, c.h, c.hu, w, h)
		}
	}
	if p := one(t, row("Growth", "[Growth] Head Size", "38", "[Growth] Head Size Unit", "CM"), "imperial"); at(t, p.HeadCirc, 0).Value != 15 {
		t.Errorf("38 cm head = %v in, want 15", p.HeadCirc[0].Value)
	}
}

func TestNaraGrowthDateUsesTheRowsTimeZone(t *testing.T) {
	// 2026-09-14T22:00Z is midnight on the 15th in Copenhagen, where Nara
	// logged it, but still the 14th in New York.
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	opts := naraOptions{UnitSystem: "metric", Location: ny, Now: naraNow}
	p := parseNara(t, naraExport(t, naraHeader,
		nrow{"Type": "Growth", "Start Date/time (Epoch)": "1789423200000", "Time Zone": "Europe/Copenhagen", "[Growth] Weight": "4", "[Growth] Weight Unit": "KG"},
		nrow{"Type": "Growth", "Start Date/time (Epoch)": "1789423200000", "Time Zone": "Europe/Copenhagen", "[Growth] Weight": "4.1", "[Growth] Weight Unit": "KG"},
		nrow{"Type": "Growth", "Start Date/time (Epoch)": "1789423200000", "Time Zone": "Not/AZone", "[Growth] Weight": "4.2", "[Growth] Weight Unit": "KG"},
		nrow{"Type": "Growth", "Start Date/time (Epoch)": "1789423200000", "[Growth] Weight": "4.3", "[Growth] Weight Unit": "KG"},
	), opts)
	// Rows 1-2 use their own zone (the second from the cache); rows 3-4 fall
	// back to the importer's zone.
	var dates []string
	for _, w := range p.Weight {
		dates = append(dates, w.Date)
	}
	if got := strings.Join(dates, ","); got != "2026-09-15,2026-09-15,2026-09-14,2026-09-14" {
		t.Errorf("dates = %s", got)
	}
}

func TestNaraGrowthBadValueAddsNothing(t *testing.T) {
	for name, c := range map[string]struct {
		r            nrow
		code, detail string
	}{
		"unknown height unit": {row("Growth", "[Growth] Weight", "4", "[Growth] Weight Unit", "KG", "[Growth] Height", "20", "[Growth] Height Unit", "FATHOMS"), "unknown_unit", "[Growth] Height"},
		"missing height unit": {row("Growth", "[Growth] Weight", "4", "[Growth] Weight Unit", "KG", "[Growth] Height", "20"), "missing_unit", "[Growth] Height"},
		"missing weight unit": {row("Growth", "[Growth] Weight", "4", "[Growth] Height", "55", "[Growth] Height Unit", "CM"), "missing_unit", "[Growth] Weight"},
		"unknown weight unit": {row("Growth", "[Growth] Weight", "4", "[Growth] Weight Unit", "STONE"), "unknown_unit", "[Growth] Weight"},
		"head size unit":      {row("Growth", "[Growth] Weight", "4", "[Growth] Weight Unit", "KG", "[Growth] Head Size", "38", "[Growth] Head Size Unit", "FT"), "unknown_unit", "[Growth] Head Size"},
		"nothing measured":    {row("Growth"), "no_measurements", ""},
	} {
		if got := rejected(t, c.r); got.Code != c.code || got.Detail != c.detail {
			t.Errorf("%s: %+v", name, got)
		}
	}
}

func TestNaraMedical(t *testing.T) {
	p := one(t, row("Medical", "[Medical] Medication", "Children's Tylenol, 3.75 (ML)",
		"[Medical] Temperature", "100.4", "[Medical] Temperature Unit", "F", "Note", "fever"), "metric")
	if m := at(t, p.Medications, 0); m.Name != "Children's Tylenol" || m.Dosage != "3.75" || m.DosageUnit != "ml" || m.Notes != "fever" {
		t.Errorf("medication %+v", m)
	}
	if tp := at(t, p.Temperature, 0); tp.Value != 38 || tp.Notes != "" {
		t.Errorf("temperature %+v", tp)
	}

	if p := one(t, row("Medical", "[Medical] Temperature", "38", "[Medical] Temperature Unit", "C", "Note", "after bath"), "imperial"); at(t, p.Temperature, 0).Value != 100.4 || p.Temperature[0].Notes != "after bath" {
		t.Errorf("38 C on imperial = %+v", p.Temperature)
	}
	if p := one(t, row("Medical", "[Medical] Medication", "Vitamin D drops"), "metric"); at(t, p.Medications, 0).Name != "Vitamin D drops" || p.Medications[0].Dosage != "" {
		t.Errorf("free-text medication %+v", p.Medications)
	}
	if p := one(t, row("Medical", "[Medical] Medication", "Ibuprofen, 2,5 (ML)"), "metric"); at(t, p.Medications, 0).Dosage != "2,5" {
		t.Errorf("comma decimal dose %+v", p.Medications)
	}
	p = one(t, row("Medical", "[Medical] Medication", "Tylenol, 1.5 (ML)\nVitamin D", "Note", "evening"), "metric")
	if len(p.Medications) != 2 || p.Medications[0].Name != "Tylenol" || p.Medications[0].Notes != "evening" || p.Medications[1].Name != "Vitamin D" || p.Medications[1].Notes != "" {
		t.Errorf("two medicines in one entry %+v", p.Medications)
	}
	if p := one(t, row("Medical", "Note", "Pediatrician call"), "metric"); strings.Join(noteTexts(p), "|") != "Medical: Pediatrician call" || p.AsNotes["Medical"] != 1 {
		t.Errorf("note-only medical %v %v", noteTexts(p), p.AsNotes)
	}
	// A bad temperature rejects the whole row, medication included.
	if got := rejected(t, row("Medical", "[Medical] Medication", "Tylenol", "[Medical] Temperature", "38", "[Medical] Temperature Unit", "K")); got.Code != "unknown_unit" || got.Value != "K" {
		t.Errorf("bad unit %+v", got)
	}
	if got := rejected(t, row("Medical", "[Medical] Temperature", "38")); got.Code != "missing_unit" {
		t.Errorf("no unit %+v", got)
	}
	if got := rejected(t, row("Medical")); got.Code != "empty_entry" {
		t.Errorf("empty medical %+v", got)
	}
}

func TestNaraMilestonesAndNotes(t *testing.T) {
	p := parseNara(t, naraExport(t, naraHeader,
		row("Milestone", "[Milestone] Milestone", "Sits without support", "Time Zone", "Pacific/Auckland", "Note", "on the rug"),
		row("Milestone", "Note", "First smile!"),
		row("Baby First", "[Baby First] Baby First", "Bath", "Note", "loved it"),
		row("Routine", "[Routine] Routine", "Tummy time", "Note", "10 min"),
		row("Vaccine", "[Vaccine] Vaccine", "Hep B"),
		row("Journal", "Note", "Big day"),
		row("Journal"),
		row("Postpartum Mood", "Note", "tired"), // a parent's row: not the baby's, not even as a note
	), naraOpts("metric"))
	if p.RejectedCount != 0 || len(p.Milestones) != 3 {
		t.Fatalf("rejected %+v milestones %+v", p.Rejected, p.Milestones)
	}
	if m := p.Milestones[0]; m.Title != "Sits without support" || m.Date != "2026-09-17" || m.Description != "on the rug" {
		t.Errorf("milestone %+v (Auckland date)", m)
	}
	if m := p.Milestones[1]; m.Title != "First smile!" || m.Description != "" {
		t.Errorf("note-titled milestone %+v", m)
	}
	if m := p.Milestones[2]; m.Title != "Bath" || m.Description != "loved it" {
		t.Errorf("baby first %+v", m)
	}
	if want := "Routine: Tummy time; 10 min|Vaccine: Hep B|Journal: Big day"; strings.Join(noteTexts(p), "|") != want {
		t.Errorf("notes %q", noteTexts(p))
	}
	if p.AsNotes["Routine"] != 1 || p.AsNotes["Vaccine"] != 1 || p.AsNotes["Journal"] != 1 || p.Skipped["Journal"] != 1 || p.Skipped["Postpartum Mood"] != 1 {
		t.Errorf("asNotes %v skipped %v", p.AsNotes, p.Skipped)
	}
	for _, typ := range []string{"Milestone", "Routine", "Vaccine", "Baby First"} {
		if got := rejected(t, row(typ)); got.Code != "empty_entry" {
			t.Errorf("empty %s: %+v", typ, got)
		}
	}
}

// --- Database ---

func TestNaraInsertPlan(t *testing.T) {
	db := setupDB(t)
	p := parseNara(t, naraExport(t, naraHeader,
		row("Breastfeed", "[Breastfeed] Left Duration (Seconds)", "600", "Note", "latch"),
		row("Bottle Feed", "[Bottle Feed] Type", "Formula", "[Bottle Feed] Formula Volume", "45", "[Bottle Feed] Formula Volume Unit", "ML"),
		row("Diaper", "[Diaper] Type", "Dirty", "[Diaper] Dirty Color", "GREEN", "Note", "after nap"),
		row("Pump", "[Pump] Left Volume", "50", "[Pump] Left Volume Unit", "ML", "[Pump] Duration (Seconds)", "600", "Note", "evening"),
		row("Growth", "[Growth] Weight", "4", "[Growth] Weight Unit", "KG", "[Growth] Height", "55", "[Growth] Height Unit", "CM",
			"[Growth] Head Size", "38", "[Growth] Head Size Unit", "CM", "Note", "checkup"),
		row("Sleep", "[Sleep] End Date/time (Epoch)", "1789585253000", "Note", "car"),
		row("Medical", "[Medical] Medication", "Tylenol, 2.5 (ML)", "[Medical] Temperature", "37.2", "[Medical] Temperature Unit", "C", "Note", "fever"),
		row("Milestone", "[Milestone] Milestone", "Rolls over", "Note", "both ways"),
		row("Routine", "[Routine] Routine", "Bath"),
	), naraOpts("metric"))

	childID, err := insertNaraPlan(context.Background(), db, naraChild{FirstName: "Rosa", LastName: "Diaz", BirthDate: "2026-08-09", Sex: "female"}, p, false)
	if err != nil {
		t.Fatal(err)
	}

	// Times are compared as UTC text; naraT0 is 2026-09-16 17:00:53 UTC.
	const t0 = "2026-09-16 17:00:53"
	for _, c := range []struct{ query, want string }{
		{`SELECT first_name||'/'||last_name||'/'||birth_date::text||'/'||sex FROM children WHERE id=$1`, "Rosa/Diaz/2026-08-09/female"},
		{`SELECT string_agg(to_char(start_time AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')||'/'||type||'/'||method||'/'||coalesce(amount::text,'-')||'/'||EXTRACT(EPOCH FROM duration)::int||'/'||notes, ',' ORDER BY id) FROM feedings WHERE child_id=$1`,
			t0 + "/breast milk/left breast/-/600/latch," + t0 + "/formula/bottle/45/0/"},
		{`SELECT to_char(time AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')||'/'||wet||'/'||solid||'/'||color||'/'||notes FROM changes WHERE child_id=$1`, t0 + "/false/true/green/after nap"},
		{`SELECT to_char(start_time AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')||'/'||amount||'/'||EXTRACT(EPOCH FROM duration)::int FROM pumping WHERE child_id=$1`, t0 + "/50/600"},
		{`SELECT date::text||'/'||weight||'/'||notes FROM weight WHERE child_id=$1`, "2026-09-16/4/checkup"},
		{`SELECT date::text||'/'||height||'/'||notes FROM height WHERE child_id=$1`, "2026-09-16/55/checkup"},
		{`SELECT date::text||'/'||head_circumference||'/'||notes FROM head_circumference WHERE child_id=$1`, "2026-09-16/38/checkup"},
		{`SELECT to_char(start_time AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')||'/'||nap||'/'||EXTRACT(EPOCH FROM duration)::int||'/'||notes FROM sleep WHERE child_id=$1`, t0 + "/true/7200/car"},
		{`SELECT to_char(time AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')||'/'||name||'/'||dosage||'/'||dosage_unit||'/'||notes FROM medications WHERE child_id=$1`, t0 + "/Tylenol/2.5/ml/fever"},
		{`SELECT to_char(time AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')||'/'||temperature||'/'||notes FROM temperature WHERE child_id=$1`, t0 + "/37.2/"},
		{`SELECT date::text||'/'||title||'/'||category||'/'||description FROM milestones WHERE child_id=$1`, "2026-09-16/Rolls over/other/both ways"},
		{`SELECT string_agg(to_char(time AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')||'/'||note, ',' ORDER BY note) FROM notes WHERE child_id=$1`,
			t0 + "/Pumping: evening," + t0 + "/Routine: Bath"},
	} {
		var got string
		if err := db.Get(&got, c.query, childID); err != nil || got != c.want {
			t.Errorf("%s\n got %q (%v)\nwant %q", c.query, got, err, c.want)
		}
	}
}

func naraCount(t *testing.T, db interface {
	Get(dest any, query string, args ...any) error
}, query string, args ...any) int {
	t.Helper()
	var n int
	if err := db.Get(&n, query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func TestNaraSiblingExportsDontDuplicateFamilyPumping(t *testing.T) {
	db := setupDB(t)
	family := row("Pump", "[Pump] Duration (Seconds)", "600", "[Pump] Total Volume", "100", "[Pump] Total Volume Unit", "ML", "Note", "shared")
	own := row("Pump", "Start Date/time (Epoch)", "1789581653000", "Profile Name", "Ana", "_profileKey", "c-1",
		"[Pump] Duration (Seconds)", "300", "[Pump] Total Volume", "50", "[Pump] Total Volume Unit", "ML")
	export := naraExport(t, naraHeader, family, own, row("Diaper", "[Diaper] Type", "Wet"))

	first, err := insertNaraPlan(context.Background(), db, naraChild{FirstName: "Ana", BirthDate: "2026-08-09"}, parseNara(t, export, naraOpts("metric")), false)
	if err != nil {
		t.Fatal(err)
	}

	// The second baby's export repeats the family session. The amount was
	// converted to another unit system, which must not defeat the match.
	p := parseNara(t, export, naraOpts("imperial"))
	if err := markDuplicatePumps(db, p); err != nil {
		t.Fatal(err)
	}
	if p.Duplicates.Count != 1 || strings.Join(p.Duplicates.Children, ",") != "Ana" {
		t.Errorf("duplicates %+v", p.Duplicates)
	}
	p = parseNara(t, export, naraOpts("imperial"))
	second, err := insertNaraPlan(context.Background(), db, naraChild{FirstName: "Bo", BirthDate: "2026-08-09"}, p, false)
	if err != nil {
		t.Fatal(err)
	}
	if p.stats()["pumping"] != 1 || p.stats()["notes"] != 0 || p.stats()["changes"] != 1 {
		t.Errorf("second import stats %v", p.stats())
	}
	if n := naraCount(t, db, `SELECT count(*) FROM pumping WHERE child_id=$1`, first); n != 2 {
		t.Errorf("first child has %d pumping sessions, want 2", n)
	}
	// The child's own session isn't family pumping, so the sibling gets it.
	if n := naraCount(t, db, `SELECT count(*) FROM pumping WHERE child_id=$1`, second); n != 1 {
		t.Errorf("second child has %d pumping sessions, want its own 1", n)
	}
	if n := naraCount(t, db, `SELECT count(*) FROM notes WHERE note = 'Pumping: shared'`); n != 1 {
		t.Errorf("%d copies of the shared pump note", n)
	}

	// Asked to, a third import takes the family session too.
	p = parseNara(t, export, naraOpts("metric"))
	third, err := insertNaraPlan(context.Background(), db, naraChild{FirstName: "Cy", BirthDate: "2026-08-09"}, p, true)
	if err != nil {
		t.Fatal(err)
	}
	if n := naraCount(t, db, `SELECT count(*) FROM pumping WHERE child_id=$1`, third); n != 2 || p.Duplicates.Count != 1 {
		t.Errorf("with duplicates included: %d sessions, duplicates %+v", n, p.Duplicates)
	}
}

func TestNaraNothingLeftCreatesNoChild(t *testing.T) {
	db := setupDB(t)
	export := naraExport(t, naraHeader, row("Pump", "[Pump] Duration (Seconds)", "600", "[Pump] Total Volume", "100", "[Pump] Total Volume Unit", "ML"))
	if _, err := insertNaraPlan(context.Background(), db, naraChild{FirstName: "Ana", BirthDate: "2026-08-09"}, parseNara(t, export, naraOpts("metric")), false); err != nil {
		t.Fatal(err)
	}
	// The only row is family pumping that's already in: nothing left.
	_, err := insertNaraPlan(context.Background(), db, naraChild{FirstName: "Bo", BirthDate: "2026-08-09"}, parseNara(t, export, naraOpts("metric")), false)
	if !errors.Is(err, errNaraNothingToImport) || naraCount(t, db, `SELECT count(*) FROM children`) != 1 {
		t.Errorf("err %v, children %d", err, naraCount(t, db, `SELECT count(*) FROM children`))
	}
}

func TestNaraInsertPlanRollsBackOnError(t *testing.T) {
	db := setupDB(t)
	p := &naraPlan{Feedings: []naraFeeding{
		{Start: naraNow, End: naraNow, Type: "breast milk", Method: "bottle"},
		{Start: naraNow, End: naraNow, Type: "not a type", Method: "bottle"}, // violates the CHECK constraint
	}}
	if _, err := insertNaraPlan(context.Background(), db, naraChild{FirstName: "Rosa", BirthDate: "2026-08-09"}, p, false); err == nil {
		t.Fatal("expected an error")
	}
	if c, f := naraCount(t, db, `SELECT count(*) FROM children`), naraCount(t, db, `SELECT count(*) FROM feedings`); c != 0 || f != 0 {
		t.Errorf("left behind %d children, %d feedings", c, f)
	}
}

// --- Handler ---

func naraMultipart(t *testing.T, path, csv string, fields map[string]string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if csv != "" {
		fw, err := mw.CreateFormFile("file", "export_narababy_rosa.csv")
		if err != nil {
			t.Fatal(err)
		}
		fw.Write([]byte(csv))
	}
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	mw.Close()
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

// naraJSON reads a decoded JSON value by path ("stats.feedings",
// "rejected.0.code"), failing the test instead of panicking when it's
// missing or has another type.
func naraJSON[T any](t *testing.T, v any, path string) T {
	t.Helper()
	cur := v
	for _, part := range strings.Split(path, ".") {
		switch node := cur.(type) {
		case map[string]any:
			cur = node[part]
		case []any:
			i := 0
			for _, c := range part {
				i = i*10 + int(c-'0')
			}
			if i >= len(node) {
				t.Fatalf("%s: index %d out of range (%d)", path, i, len(node))
			}
			cur = node[i]
		default:
			t.Fatalf("%s: can't index %T", path, cur)
		}
	}
	out, ok := cur.(T)
	if !ok {
		t.Fatalf("%s is %T (%v)", path, cur, cur)
	}
	return out
}

func TestNaraHandler(t *testing.T) {
	db := setupDB(t)
	h := NewNaraImportHandler(db, &config.Config{UnitSystem: "metric"})
	h.now = func() time.Time { return naraNow }
	serve := func(path, csv string, fields map[string]string) (int, map[string]any) {
		t.Helper()
		req := naraMultipart(t, path, csv, fields)
		req = req.WithContext(context.WithValue(req.Context(), middleware.IsAdminKey, true))
		rec := httptest.NewRecorder()
		if strings.HasSuffix(path, "/preview") {
			h.Preview(rec, req)
		} else {
			h.Import(rec, req)
		}
		var out map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("%s: response isn't JSON: %q", path, rec.Body.String())
		}
		return rec.Code, out
	}
	countChildren := func() int { return naraCount(t, db, `SELECT count(*) FROM children`) }
	// 2026-09-17T02:00Z: still the 16th in Vancouver, the 17th in UTC.
	lateGrowth := nrow{"Type": "Growth", "Start Date/time (Epoch)": "1789610400000", "[Growth] Weight": "4", "[Growth] Weight Unit": "KG"}
	export := naraExport(t, naraHeader,
		row("Bottle Feed", "[Bottle Feed] Type", "Formula", "[Bottle Feed] Formula Volume", "4", "[Bottle Feed] Formula Volume Unit", "FLOZ"),
		row("Diaper", "[Diaper] Type", "Sparkly"),
		row("Bottle Feed", "[Bottle Feed] Volume", "60", "[Bottle Feed] Volume Unit", "ML"),
		row("Milestone", "[Milestone] Milestone", "Rolls over"),
		lateGrowth,
		nrow{"Type": "Profile", "Profile Name": "Rosa", "[Profile] Type": "CHILD", "[Profile] Birth Date": "2026-08-09", "[Profile] Sex": "FEMALE"},
	)

	t.Run("non-admin", func(t *testing.T) {
		for _, path := range []string{"/api/import/nara", "/api/import/nara/preview"} {
			req := naraMultipart(t, path, export, map[string]string{"first_name": "Rosa", "birth_date": "2026-08-09"})
			req = req.WithContext(context.WithValue(req.Context(), middleware.IsAdminKey, false))
			rec := httptest.NewRecorder()
			if strings.HasSuffix(path, "/preview") {
				h.Preview(rec, req)
			} else {
				h.Import(rec, req)
			}
			if rec.Code != http.StatusForbidden || countChildren() != 0 {
				t.Errorf("%s: status %d", path, rec.Code)
			}
		}
	})

	t.Run("preview saves nothing", func(t *testing.T) {
		code, out := serve("/api/import/nara/preview", export, map[string]string{"unit_system": "imperial"})
		if code != http.StatusOK || out["status"] != "preview" || countChildren() != 0 {
			t.Fatalf("status %d body %v children %d", code, out, countChildren())
		}
		if naraJSON[string](t, out, "profile.name") != "Rosa" || naraJSON[string](t, out, "profile.birth_date") != "2026-08-09" ||
			naraJSON[string](t, out, "profile.sex") != "female" || naraJSON[string](t, out, "units.volume") != "oz" {
			t.Errorf("body %v", out)
		}
		if naraJSON[float64](t, out, "warning_count") != 1 || naraJSON[string](t, out, "warnings.0.code") != "milk_type_unknown" ||
			naraJSON[float64](t, out, "duplicate_pumping.count") != 0 || naraJSON[float64](t, out, "solid_feeds") != 0 {
			t.Errorf("body %v", out)
		}
	})

	t.Run("upload and form errors", func(t *testing.T) {
		for name, c := range map[string]struct {
			path, csv string
			fields    map[string]string
			code      string
		}{
			"not a Nara file": {"/api/import/nara/preview", "a,b\n1,2\n", nil, "not_nara_export"},
			"no file":         {"/api/import/nara/preview", "", map[string]string{"unit_system": "metric"}, "invalid_upload"},
			"missing name":    {"/api/import/nara", export, map[string]string{"birth_date": "2026-08-09"}, "missing_name"},
			"bad date":        {"/api/import/nara", export, map[string]string{"first_name": "Rosa", "birth_date": "9/8/2026"}, "invalid_birth_date"},
			"bad sex":         {"/api/import/nara", export, map[string]string{"first_name": "Rosa", "birth_date": "2026-08-09", "sex": "x"}, "invalid_sex"},
		} {
			code, out := serve(c.path, c.csv, c.fields)
			if code != http.StatusBadRequest || out["code"] != c.code {
				t.Errorf("%s: status %d body %v", name, code, out)
			}
		}
		// Not multipart at all.
		req := httptest.NewRequest(http.MethodPost, "/api/import/nara/preview", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		req = req.WithContext(context.WithValue(req.Context(), middleware.IsAdminKey, true))
		rec := httptest.NewRecorder()
		h.Preview(rec, req)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), `"invalid_upload"`) {
			t.Errorf("not multipart: %d %s", rec.Code, rec.Body.String())
		}
		if countChildren() != 0 {
			t.Errorf("a failed request created a child")
		}
	})

	t.Run("nothing importable creates no child", func(t *testing.T) {
		csv := naraExport(t, naraHeader, row("Diaper", "[Diaper] Type", "Sparkly"), row("Diaper", "[Diaper] Type", "Sparkly"))
		code, out := serve("/api/import/nara", csv, map[string]string{"first_name": "Rosa", "birth_date": "2026-08-09"})
		if code != http.StatusUnprocessableEntity || out["code"] != "nothing_to_import" || naraJSON[float64](t, out, "rejected_count") != 2 || countChildren() != 0 {
			t.Errorf("status %d body %v children %d", code, out, countChildren())
		}
	})

	t.Run("import", func(t *testing.T) {
		code, out := serve("/api/import/nara", export, map[string]string{
			"first_name": "Rosa", "birth_date": "2026-08-09", "sex": "female", "unit_system": "imperial", "timezone": "America/Vancouver",
		})
		if code != http.StatusOK || out["status"] != "completed" {
			t.Fatalf("status %d body %v", code, out)
		}
		for _, k := range []string{"feedings", "sleep", "changes", "pumping", "weight", "height", "head_circumference", "temperature", "medications", "milestones", "notes"} {
			naraJSON[float64](t, out, "stats."+k)
		}
		if naraJSON[float64](t, out, "stats.feedings") != 2 || naraJSON[float64](t, out, "stats.milestones") != 1 ||
			naraJSON[float64](t, out, "rejected_count") != 1 || naraJSON[float64](t, out, "warning_count") != 1 {
			t.Errorf("body %v", out)
		}
		if naraJSON[string](t, out, "rejected.0.code") != "unknown_diaper_type" || naraJSON[string](t, out, "rejected.0.value") != "Sparkly" ||
			naraJSON[float64](t, out, "rejected.0.line") != 3 {
			t.Errorf("rejection %v", out["rejected"])
		}
		childID := naraJSON[float64](t, out, "child_id")
		var stored float64
		if err := db.Get(&stored, `SELECT amount FROM feedings WHERE child_id=$1 AND type='formula'`, childID); err != nil || stored != 4 {
			t.Errorf("imperial import stored %v (%v), want 4 oz", stored, err)
		}
		// The browser's zone dates rows that carry none.
		var date string
		if err := db.Get(&date, `SELECT date::text FROM weight WHERE child_id=$1`, childID); err != nil || date != "2026-09-16" {
			t.Errorf("weight date %q (%v), want the Vancouver date", date, err)
		}
	})

	t.Run("unknown browser zone falls back to UTC", func(t *testing.T) {
		csv := naraExport(t, naraHeader, lateGrowth)
		code, out := serve("/api/import/nara", csv, map[string]string{"first_name": "Ola", "birth_date": "2026-08-09", "timezone": "Not/AZone"})
		if code != http.StatusOK {
			t.Fatalf("status %d body %v", code, out)
		}
		var date string
		if err := db.Get(&date, `SELECT date::text FROM weight WHERE child_id=$1`, naraJSON[float64](t, out, "child_id")); err != nil || date != "2026-09-17" {
			t.Errorf("weight date %q (%v), want the UTC date", date, err)
		}
	})

	t.Run("duplicate family pumping is reported and can be imported", func(t *testing.T) {
		csv := naraExport(t, naraHeader, row("Pump", "[Pump] Duration (Seconds)", "600", "[Pump] Total Volume", "100", "[Pump] Total Volume Unit", "ML"))
		if code, out := serve("/api/import/nara", csv, map[string]string{"first_name": "Ana", "birth_date": "2026-08-09"}); code != http.StatusOK {
			t.Fatalf("first import: %d %v", code, out)
		}
		code, out := serve("/api/import/nara/preview", csv, nil)
		if code != http.StatusOK || naraJSON[float64](t, out, "duplicate_pumping.count") != 1 ||
			naraJSON[string](t, out, "duplicate_pumping.children.0") != "Ana" || naraJSON[float64](t, out, "stats.pumping") != 0 {
			t.Errorf("preview %d %v", code, out)
		}
		if code, out := serve("/api/import/nara", csv, map[string]string{"first_name": "Bo", "birth_date": "2026-08-09"}); code != http.StatusUnprocessableEntity || out["code"] != "nothing_to_import" {
			t.Errorf("skipping the duplicate: %d %v", code, out)
		}
		code, out = serve("/api/import/nara", csv, map[string]string{"first_name": "Bo", "birth_date": "2026-08-09", "duplicate_pumping": "import"})
		if code != http.StatusOK || naraJSON[float64](t, out, "stats.pumping") != 1 {
			t.Errorf("importing the duplicate: %d %v", code, out)
		}
	})

	t.Run("issue lists are capped, counts are not", func(t *testing.T) {
		rows := []nrow{row("Diaper", "[Diaper] Type", "Wet")}
		for i := 0; i < 60; i++ {
			rows = append(rows, row("Diaper", "[Diaper] Type", "Sparkly"))
		}
		code, out := serve("/api/import/nara/preview", naraExport(t, naraHeader, rows...), nil)
		if code != http.StatusOK || len(naraJSON[[]any](t, out, "rejected")) != naraIssueCap || naraJSON[float64](t, out, "rejected_count") != 60 ||
			len(naraJSON[[]any](t, out, "warnings")) != 0 {
			t.Errorf("status %d body %v", code, out)
		}
	})
}

func TestNaraHandlerRejectsOversizedUploads(t *testing.T) {
	h := NewNaraImportHandler(nil, &config.Config{UnitSystem: "metric"})
	req := naraMultipart(t, "/api/import/nara/preview", strings.Repeat("x", naraMaxUpload+1), nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.IsAdminKey, true))
	rec := httptest.NewRecorder()
	h.Preview(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge || !strings.Contains(rec.Body.String(), `"too_large"`) || !strings.Contains(rec.Body.String(), `"detail":"50"`) {
		t.Errorf("status %d body %s", rec.Code, rec.Body.String())
	}
}
