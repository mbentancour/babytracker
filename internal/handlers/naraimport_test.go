package handlers

import (
	"strings"
	"testing"
	"time"
)

// naraCSV builds an export with the column layout Nara uses: a Type column,
// an epoch-ms start, a Note, and type-prefixed fields. Each row is a map of
// column → value; unset columns are empty.
func naraCSV(rows ...map[string]string) string {
	header := []string{
		"Type", "Start Date/time (Epoch)", "Note",
		"[Breastfeed] Begin Side", "[Breastfeed] End Side",
		"[Breastfeed] Left Duration (Seconds)", "[Breastfeed] Right Duration (Seconds)",
		"[Bottle Feed] Type", "[Bottle Feed] Formula Name",
		"[Bottle Feed] Breast Milk Volume", "[Bottle Feed] Breast Milk Volume Unit",
		"[Bottle Feed] Formula Volume", "[Bottle Feed] Formula Volume Unit",
		"[Bottle Feed] Volume", "[Bottle Feed] Volume Unit",
		"[Combo Feed] Begin Side", "[Combo Feed] Left Duration (Seconds)", "[Combo Feed] Right Duration (Seconds)",
		"[Combo Feed] Type", "[Combo Feed] Formula Volume", "[Combo Feed] Formula Volume Unit",
		"[Diaper] Type", "[Diaper] Detail", "[Diaper] Dirty Color", "[Diaper] Dirty Texture",
		"[Pump] End Date/time (Epoch)", "[Pump] Duration (Seconds)",
		"[Pump] Left Volume", "[Pump] Left Volume Unit", "[Pump] Right Volume", "[Pump] Right Volume Unit",
		"[Growth] Weight", "[Growth] Weight Unit", "[Growth] Height", "[Growth] Height Unit",
		"[Growth] Head Size", "[Growth] Head Size Unit",
		"[Sleep] End Date/time (Epoch)",
	}
	var b strings.Builder
	b.WriteString("\uFEFF" + strings.Join(header, ",") + "\n")
	for _, r := range rows {
		vals := make([]string, len(header))
		for i, h := range header {
			vals[i] = r[h]
		}
		b.WriteString(strings.Join(vals, ",") + "\n")
	}
	return b.String()
}

// 2026-09-16T17:00:53Z
const naraT0 = "1789578053000"

func parseNara(t *testing.T, csv, units string) *naraPlan {
	t.Helper()
	p, err := parseNaraExport(strings.NewReader(csv), naraOptions{UnitSystem: units, Location: time.UTC})
	if err != nil {
		t.Fatalf("parseNaraExport: %v", err)
	}
	return p
}

func TestNaraRejectsNonNaraCSV(t *testing.T) {
	_, err := parseNaraExport(strings.NewReader("date,amount\n2026-01-01,5\n"), naraOptions{})
	if err != errNotNaraExport {
		t.Fatalf("got %v, want errNotNaraExport", err)
	}
}

func TestNaraBreastfeed(t *testing.T) {
	p := parseNara(t, naraCSV(
		map[string]string{"Type": "Breastfeed", "Start Date/time (Epoch)": naraT0,
			"[Breastfeed] Begin Side": "LEFT", "[Breastfeed] End Side": "RIGHT",
			"[Breastfeed] Left Duration (Seconds)": "600", "[Breastfeed] Right Duration (Seconds)": "300",
			"Note": "sleepy"},
		map[string]string{"Type": "Breastfeed", "Start Date/time (Epoch)": naraT0,
			"[Breastfeed] Begin Side": "RIGHT.nonTimer"},
	), "metric")
	if len(p.Feedings) != 2 || len(p.Rejected) != 0 {
		t.Fatalf("feedings=%d rejected=%v", len(p.Feedings), p.Rejected)
	}
	f := p.Feedings[0]
	if f.Method != "both breasts" || f.Type != "breast milk" || f.Notes != "sleepy" {
		t.Errorf("got %+v", f)
	}
	if want := time.Date(2026, 9, 16, 17, 0, 53, 0, time.UTC); !f.Start.Equal(want) {
		t.Errorf("start = %v, want %v", f.Start, want)
	}
	if d := f.End.Sub(f.Start); d != 15*time.Minute {
		t.Errorf("duration = %v, want 15m", d)
	}
	if m := p.Feedings[1].Method; m != "right breast" {
		t.Errorf("untimed feed method = %q, want right breast from Begin Side", m)
	}
}

func TestNaraBottle(t *testing.T) {
	p := parseNara(t, naraCSV(
		map[string]string{"Type": "Bottle Feed", "Start Date/time (Epoch)": naraT0,
			"[Bottle Feed] Type": "Formula", "[Bottle Feed] Formula Name": "Good Start",
			"[Bottle Feed] Formula Volume": "45", "[Bottle Feed] Formula Volume Unit": "ML"},
		map[string]string{"Type": "Bottle Feed", "Start Date/time (Epoch)": naraT0,
			"[Bottle Feed] Type":               "Breast Milk Formula",
			"[Bottle Feed] Breast Milk Volume": "30", "[Bottle Feed] Breast Milk Volume Unit": "ML",
			"[Bottle Feed] Formula Volume": "40", "[Bottle Feed] Formula Volume Unit": "ML"},
		map[string]string{"Type": "Bottle Feed", "Start Date/time (Epoch)": naraT0,
			"[Bottle Feed] Type": "Breast Milk", "[Bottle Feed] Volume": "2", "[Bottle Feed] Volume Unit": "OZ"},
	), "metric")
	if len(p.Feedings) != 3 || len(p.Rejected) != 0 {
		t.Fatalf("feedings=%d rejected=%v", len(p.Feedings), p.Rejected)
	}
	formula, mixed, oz := p.Feedings[0], p.Feedings[1], p.Feedings[2]
	if formula.Type != "formula" || formula.Method != "bottle" || *formula.Amount != 45 || formula.Notes != "Formula: Good Start" {
		t.Errorf("formula bottle = %+v", formula)
	}
	if mixed.Type != "formula" || *mixed.Amount != 70 || !strings.Contains(mixed.Notes, "30 mL breast milk + 40 mL formula") {
		t.Errorf("mixed bottle = %+v (amount %v)", mixed, *mixed.Amount)
	}
	if oz.Type != "breast milk" || *oz.Amount != 59.1 {
		t.Errorf("2 oz bottle on a metric instance = %v mL, want 59.1", *oz.Amount)
	}
}

func TestNaraVolumesConvertToImperial(t *testing.T) {
	p := parseNara(t, naraCSV(
		map[string]string{"Type": "Bottle Feed", "Start Date/time (Epoch)": naraT0,
			"[Bottle Feed] Type": "Formula", "[Bottle Feed] Formula Volume": "120", "[Bottle Feed] Formula Volume Unit": "ML"},
		map[string]string{"Type": "Bottle Feed", "Start Date/time (Epoch)": naraT0,
			"[Bottle Feed] Type": "Formula", "[Bottle Feed] Formula Volume": "4", "[Bottle Feed] Formula Volume Unit": "OZ"},
	), "imperial")
	if a := *p.Feedings[0].Amount; a != 4.06 {
		t.Errorf("120 mL = %v oz, want 4.06", a)
	}
	if a := *p.Feedings[1].Amount; a != 4 {
		t.Errorf("4 oz = %v oz, want 4", a)
	}
}

func TestNaraRejectsVolumeWithoutUnit(t *testing.T) {
	p := parseNara(t, naraCSV(
		map[string]string{"Type": "Bottle Feed", "Start Date/time (Epoch)": naraT0,
			"[Bottle Feed] Type": "Formula", "[Bottle Feed] Formula Volume": "4"},
	), "metric")
	if len(p.Feedings) != 0 || len(p.Rejected) != 1 || p.Rejected[0].Line != 2 {
		t.Fatalf("feedings=%d rejected=%+v", len(p.Feedings), p.Rejected)
	}
}

func TestNaraComboFeedSplitsIntoTwoFeedings(t *testing.T) {
	p := parseNara(t, naraCSV(
		map[string]string{"Type": "Combo Feed", "Start Date/time (Epoch)": naraT0,
			"[Combo Feed] Begin Side": "LEFT", "[Combo Feed] Left Duration (Seconds)": "480",
			"[Combo Feed] Type": "Formula", "[Combo Feed] Formula Volume": "60", "[Combo Feed] Formula Volume Unit": "ML"},
	), "metric")
	if len(p.Feedings) != 2 {
		t.Fatalf("feedings=%d rejected=%v", len(p.Feedings), p.Rejected)
	}
	if p.Feedings[0].Method != "left breast" || p.Feedings[1].Method != "bottle" || *p.Feedings[1].Amount != 60 {
		t.Errorf("got %+v / %+v", p.Feedings[0], p.Feedings[1])
	}
}

func TestNaraDiaper(t *testing.T) {
	p := parseNara(t, naraCSV(
		map[string]string{"Type": "Diaper", "Start Date/time (Epoch)": naraT0,
			"[Diaper] Type": "Dirty Wet", "[Diaper] Detail": "Blowout",
			"[Diaper] Dirty Color": "RED YELLOW", "[Diaper] Dirty Texture": "MUSH RUN"},
		map[string]string{"Type": "Diaper", "Start Date/time (Epoch)": naraT0, "[Diaper] Type": "Dry"},
		map[string]string{"Type": "Diaper", "Start Date/time (Epoch)": naraT0, "[Diaper] Type": "Sparkly"},
	), "metric")
	if len(p.Changes) != 2 || len(p.Rejected) != 1 {
		t.Fatalf("changes=%d rejected=%+v", len(p.Changes), p.Rejected)
	}
	c := p.Changes[0]
	if !c.Wet || !c.Solid || c.Color != "yellow" {
		t.Errorf("got %+v", c)
	}
	for _, want := range []string{"mushy, runny", "red", "Blowout"} {
		if !strings.Contains(c.Notes, want) {
			t.Errorf("notes %q missing %q", c.Notes, want)
		}
	}
	if dry := p.Changes[1]; dry.Wet || dry.Solid {
		t.Errorf("dry diaper = %+v", dry)
	}
}

func TestNaraPump(t *testing.T) {
	p := parseNara(t, naraCSV(
		map[string]string{"Type": "Pump", "Start Date/time (Epoch)": naraT0, "Note": "evening",
			"[Pump] End Date/time (Epoch)": "1789579433000",
			"[Pump] Left Volume":           "70", "[Pump] Left Volume Unit": "ML",
			"[Pump] Right Volume": "60", "[Pump] Right Volume Unit": "ML"},
	), "metric")
	if len(p.Pumping) != 1 {
		t.Fatalf("pumping=%d rejected=%v", len(p.Pumping), p.Rejected)
	}
	pm := p.Pumping[0]
	if *pm.Amount != 130 || pm.End.Sub(pm.Start) != 23*time.Minute {
		t.Errorf("got amount %v, duration %v", *pm.Amount, pm.End.Sub(pm.Start))
	}
	if len(p.Notes) != 1 || p.Notes[0].Note != "Pumping: evening" {
		t.Errorf("pump note not kept: %+v", p.Notes)
	}
}

func TestNaraGrowth(t *testing.T) {
	row := map[string]string{"Type": "Growth", "Start Date/time (Epoch)": naraT0,
		"[Growth] Weight": "9.80625", "[Growth] Weight Unit": "LB",
		"[Growth] Height": "55", "[Growth] Height Unit": "CM"}

	metric := parseNara(t, naraCSV(row), "metric")
	if len(metric.Weight) != 1 || metric.Weight[0].Value != 4.448 || metric.Weight[0].Date != "2026-09-16" {
		t.Errorf("metric weight = %+v", metric.Weight)
	}
	if len(metric.Height) != 1 || metric.Height[0].Value != 55 || len(metric.HeadCirc) != 0 {
		t.Errorf("metric height=%+v head=%+v", metric.Height, metric.HeadCirc)
	}

	imperial := parseNara(t, naraCSV(row), "imperial")
	if imperial.Weight[0].Value != 9.81 || imperial.Height[0].Value != 21.65 {
		t.Errorf("imperial weight=%v height=%v", imperial.Weight[0].Value, imperial.Height[0].Value)
	}
}

func TestNaraGrowthDateUsesImporterTimezone(t *testing.T) {
	// 2026-09-17 02:00 UTC is still the 16th in Vancouver.
	tz, err := time.LoadLocation("America/Vancouver")
	if err != nil {
		t.Skip("no tzdata")
	}
	csv := naraCSV(map[string]string{"Type": "Growth", "Start Date/time (Epoch)": "1789610400000",
		"[Growth] Weight": "4", "[Growth] Weight Unit": "KG"})
	p, err := parseNaraExport(strings.NewReader(csv), naraOptions{UnitSystem: "metric", Location: tz})
	if err != nil {
		t.Fatal(err)
	}
	if got := p.Weight[0].Date; got != "2026-09-16" {
		t.Errorf("date = %s, want 2026-09-16", got)
	}
}

func TestNaraGrowthBadUnitAddsNothing(t *testing.T) {
	p := parseNara(t, naraCSV(map[string]string{"Type": "Growth", "Start Date/time (Epoch)": naraT0,
		"[Growth] Weight": "4", "[Growth] Weight Unit": "KG",
		"[Growth] Height": "20", "[Growth] Height Unit": "FATHOMS"}), "metric")
	if len(p.Weight)+len(p.Height) != 0 || len(p.Rejected) != 1 {
		t.Errorf("weight=%v height=%v rejected=%v", p.Weight, p.Height, p.Rejected)
	}
}

func TestNaraSleep(t *testing.T) {
	p := parseNara(t, naraCSV(
		map[string]string{"Type": "Sleep", "Start Date/time (Epoch)": naraT0, "[Sleep] End Date/time (Epoch)": "1789585253000"},
		map[string]string{"Type": "Sleep", "Start Date/time (Epoch)": naraT0},
	), "metric")
	if len(p.Sleep) != 1 || p.Sleep[0].End.Sub(p.Sleep[0].Start) != 2*time.Hour {
		t.Errorf("sleep = %+v", p.Sleep)
	}
	if len(p.Rejected) != 1 || p.Rejected[0].Type != "Sleep" {
		t.Errorf("sleep without an end should be rejected: %+v", p.Rejected)
	}
}

func TestNaraSkipsUnsupportedTypesAndShortRows(t *testing.T) {
	csv := naraCSV(
		map[string]string{"Type": "Milestone", "Start Date/time (Epoch)": naraT0},
		map[string]string{"Type": "Milestone", "Start Date/time (Epoch)": naraT0},
	) + "Profile,1789578053000\n" // trailing Profile row with fewer fields
	p := parseNara(t, csv, "metric")
	if p.Skipped["Milestone"] != 2 || p.Skipped["Profile"] != 0 || len(p.Rejected) != 0 {
		t.Errorf("skipped=%v rejected=%v", p.Skipped, p.Rejected)
	}
}

func TestNaraRejectsBadStartTime(t *testing.T) {
	p := parseNara(t, naraCSV(map[string]string{"Type": "Diaper", "[Diaper] Type": "Wet"}), "metric")
	if len(p.Rejected) != 1 || !strings.Contains(p.Rejected[0].Reason, "start time") {
		t.Errorf("rejected=%+v", p.Rejected)
	}
}

func TestNaraInsertPlan(t *testing.T) {
	db := setupDB(t)
	p := parseNara(t, naraCSV(
		map[string]string{"Type": "Breastfeed", "Start Date/time (Epoch)": naraT0, "[Breastfeed] Left Duration (Seconds)": "600"},
		map[string]string{"Type": "Bottle Feed", "Start Date/time (Epoch)": naraT0,
			"[Bottle Feed] Type": "Formula", "[Bottle Feed] Formula Volume": "45", "[Bottle Feed] Formula Volume Unit": "ML"},
		map[string]string{"Type": "Diaper", "Start Date/time (Epoch)": naraT0, "[Diaper] Type": "Dirty", "[Diaper] Dirty Color": "GREEN"},
		map[string]string{"Type": "Pump", "Start Date/time (Epoch)": naraT0, "Note": "x",
			"[Pump] Left Volume": "50", "[Pump] Left Volume Unit": "ML"},
		map[string]string{"Type": "Growth", "Start Date/time (Epoch)": naraT0,
			"[Growth] Weight": "4", "[Growth] Weight Unit": "KG",
			"[Growth] Height": "55", "[Growth] Height Unit": "CM",
			"[Growth] Head Size": "38", "[Growth] Head Size Unit": "CM"},
		map[string]string{"Type": "Sleep", "Start Date/time (Epoch)": naraT0, "[Sleep] End Date/time (Epoch)": "1789585253000"},
	), "metric")

	childID, stats, err := insertNaraPlan(db, "Rosa", "", "2026-08-09", p)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"feedings": 2, "sleep": 1, "changes": 1, "pumping": 1,
		"weight": 1, "height": 1, "head-circumference": 1, "notes": 1}
	for k, n := range want {
		if stats[k] != n {
			t.Errorf("stats[%s] = %d, want %d", k, stats[k], n)
		}
	}

	var feedMinutes float64
	if err := db.Get(&feedMinutes,
		`SELECT EXTRACT(EPOCH FROM duration)/60 FROM feedings WHERE child_id=$1 AND method='left breast'`, childID); err != nil {
		t.Fatal(err)
	}
	if feedMinutes != 10 {
		t.Errorf("breastfeed duration = %v min, want 10", feedMinutes)
	}
	var color string
	if err := db.Get(&color, `SELECT color FROM changes WHERE child_id=$1`, childID); err != nil || color != "green" {
		t.Errorf("change color = %q (%v)", color, err)
	}
}
