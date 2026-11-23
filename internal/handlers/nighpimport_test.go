package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/mbentancour/babytracker/internal/config"
	"github.com/mbentancour/babytracker/internal/middleware"
)

// The shapes of a real export (issue #25), with made-up entries.
const (
	nighpSleepCSV = "Baby,Time,Duration (min),Note\n" +
		"Rosa,7/19/2026 12:05,115,\n" +
		"Rosa,7/19/2026 22:30,480,slept through\n"
	nighpDiaperCSV = "Baby,Time,Status,Note\n" +
		"Rosa,6/17/2026 1:50,Dirty,big one\n" +
		"Rosa,6/17/2026 17:15,Wet,\n" +
		"Rosa,6/18/2026 7:00,Mixed,\n"
	nighpNursingCSV = "Baby,Time,Start side,Left duration (min),Right Duration (min),Total (min),Note\n" +
		"Rosa,6/17/2026 2:05,Left,5,5,10,\n" +
		"Rosa,6/17/2026 5:17,Right,,58,58,sleepy\n" +
		"Rosa,6/17/2026 18:25,Left,7,,7,\n"
	nighpExpressedCSV = "Baby,Time,Amount (oz.),Note\n" +
		"Rosa,7/19/2026 17:16,2.5,\n"
	nighpGrowthCSV = "Baby,Time,Length (inches),Weight (lbs.),Head Size (inches),Note\n" +
		"Rosa,6/17/2026 3:23,18.5,6.25,,birth\n" +
		"Rosa,6/19/2026 3:24,,6.19,13.5,\n"
	nighpPumpCSV = "Time,Start side,Left duration (min),Right Duration (min),Total duration (min),Left Amount (oz.),Right Amount (oz.),Total amount (oz.),Note\n" +
		"7/7/26 11:04 PM,Left,10,10,10,2,1.5,3.5,\n" +
		"7/8/26 4:43 PM,,,,,,,2,spilled some\n"
)

var nighpNow = time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)

func nighpOpts(units string) importOptions {
	return importOptions{UnitSystem: units, Location: time.UTC, Now: nighpNow}
}

// nighpParse parses name/content pairs into files.
func nighpParse(t *testing.T, pairs ...string) []*nighpFile {
	t.Helper()
	var files []*nighpFile
	for i := 0; i+1 < len(pairs); i += 2 {
		f, err := nighpParseCSV(pairs[i], []byte(pairs[i+1]))
		if err != nil {
			t.Fatalf("nighpParseCSV(%s): %v", pairs[i], err)
		}
		files = append(files, f)
	}
	return files
}

func nighpPlan(t *testing.T, opts importOptions, bo nighpOptions, pairs ...string) (*importPlan, *nighpInfo) {
	t.Helper()
	p, info, err := nighpBuildPlan(nighpParse(t, pairs...), opts, bo)
	if err != nil {
		t.Fatalf("nighpBuildPlan: %v", err)
	}
	return p, info
}

// nighpClean parses one file that must import without rejections.
func nighpClean(t *testing.T, units, name, csv string) *importPlan {
	t.Helper()
	p, _ := nighpPlan(t, nighpOpts(units), nighpOptions{}, name, csv)
	if p.RejectedCount != 0 {
		t.Fatalf("unexpected rejection: %+v", p.Rejected)
	}
	return p
}

func nighpFileErrorCode(t *testing.T, err error) string {
	t.Helper()
	var fe *importFileError
	if !errors.As(err, &fe) {
		t.Fatalf("want a file error, got %v", err)
	}
	return fe.Code
}

func utc(s string) time.Time {
	t, err := time.Parse("2006-01-02 15:04", s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestNighpClassifiesFilesByHeader(t *testing.T) {
	files := nighpParse(t,
		"Rosa_sleep.csv", nighpSleepCSV,
		"renamed.csv", "\xEF\xBB\xBF"+nighpDiaperCSV, // a BOM, and a name that says nothing
		"Rosa_nursing.csv", nighpNursingCSV,
		"Rosa_expressed.csv", nighpExpressedCSV,
		"Rosa_formula.csv", nighpExpressedCSV,
		"Rosa_supplement.csv", nighpExpressedCSV, // same header, but which milk isn't known
		"Rosa_growth.csv", nighpGrowthCSV,
		"pump.csv", nighpPumpCSV,
		"notes.csv", "Title,Body\nhello,world\n",
	)
	var got []string
	for _, f := range files {
		got = append(got, f.kind+"/"+f.milk)
	}
	want := []string{"sleep/", "diaper/", "nursing/", "bottle/breast milk", "bottle/formula", "/", "growth/", "pump/", "/"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("kinds %v, want %v", got, want)
	}
	if u := files[6].units; u["weight"] != "LB" || u["length"] != "IN" || u["head size"] != "IN" {
		t.Errorf("growth units %v", u)
	}
	if u := files[7].units; u["total amount"] != "OZ" || u["total duration"] != "MIN" {
		t.Errorf("pump units %v", u)
	}
}

func TestNighpRejectsOtherFiles(t *testing.T) {
	_, _, err := nighpBuildPlan(nighpParse(t, "notes.csv", "Title,Body\nhello,world\n"), nighpOpts("metric"), nighpOptions{})
	if err != errNotNighpExport {
		t.Errorf("want errNotNighpExport, got %v", err)
	}
	if _, err := nighpParseCSV("Rosa_sleep.csv", []byte("Baby,Time\n\"oops,1\n")); nighpFileErrorCode(t, err) != "bad_csv" {
		t.Errorf("bad CSV: %v", err)
	}
}

func TestNighpUnrecognisedFilesAreReportedAsSkipped(t *testing.T) {
	p, _ := nighpPlan(t, nighpOpts("metric"), nighpOptions{},
		"Rosa_sleep.csv", nighpSleepCSV,
		"Rosa_supplement.csv", nighpExpressedCSV)
	if p.Skipped["Rosa_supplement.csv"] != 1 || len(p.Sleep) != 2 || len(p.Feedings) != 0 {
		t.Errorf("skipped %v, stats %v", p.Skipped, p.stats())
	}
}

func TestNighpTimeFormats(t *testing.T) {
	want := time.Date(2026, 6, 17, 17, 15, 0, 0, time.UTC)
	for _, v := range []string{
		"6/17/2026 17:15", "06/17/2026 17:15:00", "6/17/26 5:15 PM", "6/17/26, 5:15 PM",
		"6/17/2026 5:15 p.m.", "2026-06-17 17:15", "2026-06-17T17:15:00", "6-17-2026 17:15", "6.17.2026 17.15",
	} {
		p := nighpClean(t, "metric", "Rosa_diaper.csv", "Baby,Time,Status,Note\nRosa,\""+v+"\",Wet,\n")
		if got := at(t, p.Changes, 0).Time; !got.Equal(want) {
			t.Errorf("%q read as %s", v, got)
		}
	}
	for _, v := range []string{"", "yesterday", "6/17/2026", "6/31/2026 10:00", "13/13/2026 10:00", "6/17/2026 25:00", "6/17/2026 13:00 PM", "6/17/1999 10:00", "6/17/2031 10:00"} {
		p, _ := nighpPlan(t, nighpOpts("metric"), nighpOptions{}, "Rosa_diaper.csv", "Baby,Time,Status,Note\nRosa,"+v+",Wet,\n")
		if p.RejectedCount != 1 || len(p.Changes) != 0 {
			t.Errorf("%q: rejected=%d changes=%d", v, p.RejectedCount, len(p.Changes))
			continue
		}
		code := at(t, p.Rejected, 0).Code
		if wantCode := map[bool]string{true: "implausible_start_time", false: "bad_start_time"}[strings.Contains(v, "1999") || strings.Contains(v, "2031")]; code != wantCode {
			t.Errorf("%q: code %s, want %s", v, code, wantCode)
		}
	}
}

func TestNighpTimesAreReadInTheImportersZone(t *testing.T) {
	loc, err := time.LoadLocation("America/Chicago")
	if err != nil {
		t.Fatal(err)
	}
	opts := importOptions{UnitSystem: "metric", Location: loc, Now: nighpNow}
	p, _ := nighpPlan(t, opts, nighpOptions{},
		"Rosa_growth.csv", "Baby,Time,Weight (kg),Note\nRosa,6/17/2026 23:30,3.5,\n",
		"Rosa_sleep.csv", "Baby,Time,Duration (min),Note\nRosa,6/17/2026 13:00,60,\n")
	// 23:30 in Chicago is already the 18th in UTC; the date stays local.
	if got := at(t, p.Weight, 0).Date; got != "2026-06-17" {
		t.Errorf("growth date %s", got)
	}
	s := at(t, p.Sleep, 0)
	if !s.Start.Equal(utc("2026-06-17 18:00")) || !s.Nap {
		t.Errorf("sleep %+v", s)
	}
}

func TestNighpDateOrder(t *testing.T) {
	diaper := func(times ...string) string {
		csv := "Baby,Time,Status,Note\n"
		for _, v := range times {
			csv += "Rosa," + v + ",Wet,\n"
		}
		return csv
	}
	for _, c := range []struct {
		name    string
		times   []string
		forced  string
		order   string
		assumed bool
		first   string // the first entry's time, UTC
	}{
		{"a day over 12 in second place means month first", []string{"3/4/2026 10:00", "3/17/2026 10:00"}, "", "mdy", false, "2026-03-04 10:00"},
		{"a day over 12 in first place means day first", []string{"3/4/2026 10:00", "17/3/2026 10:00"}, "", "dmy", false, "2026-04-03 10:00"},
		{"nothing settles it: month first, and said so", []string{"3/4/2026 10:00"}, "", "mdy", true, "2026-03-04 10:00"},
		{"year-first dates settle nothing and need nothing", []string{"2026-03-04 10:00"}, "", "mdy", true, "2026-03-04 10:00"},
		{"the caller can say", []string{"3/4/2026 10:00"}, "dmy", "dmy", false, "2026-04-03 10:00"},
	} {
		p, info := nighpPlan(t, nighpOpts("metric"), nighpOptions{DateOrder: c.forced}, "Rosa_diaper.csv", diaper(c.times...))
		if info.DateOrder != c.order || info.DateOrderAssumed != c.assumed {
			t.Errorf("%s: order %s assumed %v", c.name, info.DateOrder, info.DateOrderAssumed)
		}
		if got := at(t, p.Changes, 0).Time; !got.Equal(utc(c.first)) {
			t.Errorf("%s: first entry at %s", c.name, got)
		}
	}

	// Dates pointing both ways are refused, across files too.
	_, _, err := nighpBuildPlan(nighpParse(t,
		"Rosa_diaper.csv", diaper("3/17/2026 10:00"),
		"Rosa_sleep.csv", "Baby,Time,Duration (min),Note\nRosa,17/3/2026 10:00,30,\n",
	), nighpOpts("metric"), nighpOptions{})
	if nighpFileErrorCode(t, err) != "mixed_date_formats" {
		t.Errorf("mixed dates: %v", err)
	}
}

func TestNighpSleep(t *testing.T) {
	p := nighpClean(t, "metric", "Rosa_sleep.csv", nighpSleepCSV)
	nap, night := at(t, p.Sleep, 0), at(t, p.Sleep, 1)
	if !nap.Start.Equal(utc("2026-07-19 12:05")) || !nap.End.Equal(utc("2026-07-19 14:00")) || !nap.Nap {
		t.Errorf("nap %+v", nap)
	}
	if night.End.Sub(night.Start) != 8*time.Hour || night.Nap || night.Notes != "slept through" {
		t.Errorf("night %+v", night)
	}

	p, _ = nighpPlan(t, nighpOpts("metric"), nighpOptions{}, "Rosa_sleep.csv",
		"Baby,Time,Duration (min),Note\nRosa,7/19/2026 12:05,,\nRosa,7/19/2026 13:05,0,\nRosa,7/19/2026 14:05,2000,\nRosa,7/19/2026 15:05,abc,\n")
	var codes []string
	for _, r := range p.Rejected {
		codes = append(codes, r.Code)
	}
	if want := []string{"no_end_time", "zero_length", "too_long", "bad_number"}; !reflect.DeepEqual(codes, want) || len(p.Sleep) != 0 {
		t.Errorf("codes %v, want %v", codes, want)
	}
}

func TestNighpDiaper(t *testing.T) {
	p, _ := nighpPlan(t, nighpOpts("metric"), nighpOptions{}, "Rosa_diaper.csv",
		nighpDiaperCSV+"Rosa,6/18/2026 9:00,Dry,checked\nRosa,6/18/2026 10:00,,\nRosa,6/18/2026 11:00,Sparkly,\n")
	type change struct {
		wet, solid bool
		notes      string
	}
	var got []change
	for _, c := range p.Changes {
		got = append(got, change{c.Wet, c.Solid, c.Notes})
	}
	if want := []change{{false, true, "big one"}, {true, false, ""}, {true, true, ""}}; !reflect.DeepEqual(got, want) {
		t.Errorf("changes %v", got)
	}
	if notes := noteTexts(p); !reflect.DeepEqual(notes, []string{"Dry diaper; checked"}) || p.AsNotes["Dry diaper"] != 1 {
		t.Errorf("notes %v, as notes %v", notes, p.AsNotes)
	}
	if p.RejectedCount != 2 || at(t, p.Rejected, 0).Code != "missing_diaper_type" || at(t, p.Rejected, 1).Code != "unknown_diaper_type" {
		t.Errorf("rejected %+v", p.Rejected)
	}
}

func TestNighpNursing(t *testing.T) {
	p, _ := nighpPlan(t, nighpOpts("metric"), nighpOptions{}, "Rosa_nursing.csv", nighpNursingCSV+
		"Rosa,6/18/2026 1:00,Right,,,,\n"+ // a side but no times
		"Rosa,6/18/2026 2:00,,,,12,\n"+ // a total only
		"Rosa,6/18/2026 3:00,,,,,just a note\n"+
		"Rosa,6/18/2026 4:00,,,,,\n") // nothing at all
	type feed struct {
		method string
		length time.Duration
		notes  string
	}
	var got []feed
	for _, f := range p.Feedings {
		if f.Type != "breast milk" || f.Amount != nil {
			t.Errorf("feeding %v", f)
		}
		got = append(got, feed{f.Method, f.End.Sub(f.Start), f.Notes})
	}
	want := []feed{
		{"both breasts", 10 * time.Minute, ""},
		{"right breast", 58 * time.Minute, "sleepy"},
		{"left breast", 7 * time.Minute, ""},
		{"right breast", 0, ""},
		{"both breasts", 12 * time.Minute, "Side not recorded in Baby Tracker"},
		{"both breasts", 0, "Side not recorded in Baby Tracker; just a note"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("feedings\n got %v\nwant %v", got, want)
	}
	if codes := warningCodes(p); !reflect.DeepEqual(codes, []string{"side_unknown", "side_unknown"}) {
		t.Errorf("warnings %v", codes)
	}
	if p.RejectedCount != 1 || at(t, p.Rejected, 0).Code != "empty_entry" {
		t.Errorf("rejected %+v", p.Rejected)
	}
}

func TestNighpBottles(t *testing.T) {
	for _, c := range []struct {
		units, name, header, value string
		typ                        string
		want                       float64
	}{
		{"imperial", "Rosa_expressed.csv", "Amount (oz.)", "2.5", "breast milk", 2.5},
		{"metric", "Rosa_expressed.csv", "Amount (oz.)", "2.5", "breast milk", 73.9},
		{"metric", "Rosa_formula.csv", "Amount (ml)", "120", "formula", 120},
		{"imperial", "Rosa_formula.csv", "Amount (ml)", "120", "formula", 4.06},
	} {
		p := nighpClean(t, c.units, c.name, "Baby,Time,"+c.header+",Note\nRosa,7/19/2026 17:16,"+c.value+",top-up\n")
		f := at(t, p.Feedings, 0)
		if f.Type != c.typ || f.Method != "bottle" || amount(t, f.Amount) != c.want || !f.End.Equal(f.Start) || f.Notes != "top-up" {
			t.Errorf("%s %s in %s: %v", c.name, c.header, c.units, f)
		}
	}

	// A header without a unit can't be converted; guessing could be 30x off.
	p, _ := nighpPlan(t, nighpOpts("metric"), nighpOptions{}, "Rosa_expressed.csv",
		"Baby,Time,Amount,Note\nRosa,7/19/2026 17:16,2.5,\nRosa,7/19/2026 18:16,,\n")
	if p.RejectedCount != 2 || at(t, p.Rejected, 0).Code != "missing_unit" || at(t, p.Rejected, 1).Code != "empty_entry" {
		t.Errorf("rejected %+v", p.Rejected)
	}
}

func TestNighpGrowth(t *testing.T) {
	p := nighpClean(t, "imperial", "Rosa_growth.csv", nighpGrowthCSV)
	if got := p.Weight; len(got) != 2 || got[0] != (importMeasurement{"2026-06-17", 6.25, "birth"}) || got[1].Value != 6.19 {
		t.Errorf("weight %+v", got)
	}
	if got := p.Height; len(got) != 1 || got[0].Value != 18.5 {
		t.Errorf("height %+v", got)
	}
	if got := p.HeadCirc; len(got) != 1 || got[0] != (importMeasurement{"2026-06-19", 13.5, ""}) {
		t.Errorf("head %+v", got)
	}

	p = nighpClean(t, "metric", "Rosa_growth.csv", nighpGrowthCSV)
	if at(t, p.Weight, 0).Value != 2.83 || at(t, p.Height, 0).Value != 47 || at(t, p.HeadCirc, 0).Value != 34.3 {
		t.Errorf("metric: weight %+v height %+v head %+v", p.Weight, p.Height, p.HeadCirc)
	}

	// A bad value rejects the row before anything from it is added.
	p, _ = nighpPlan(t, nighpOpts("metric"), nighpOptions{}, "Rosa_growth.csv",
		"Baby,Time,Length (inches),Weight (lbs.),Head Size (inches),Note\nRosa,6/17/2026 3:23,18.5,600,,\nRosa,6/18/2026 3:23,,,,\n")
	if p.total() != 0 || p.RejectedCount != 2 || at(t, p.Rejected, 0).Code != "out_of_range" || at(t, p.Rejected, 1).Code != "no_measurements" {
		t.Errorf("stats %v rejected %+v", p.stats(), p.Rejected)
	}
}

func TestNighpPump(t *testing.T) {
	p := nighpClean(t, "imperial", "pump.csv", nighpPumpCSV+
		"7/9/26 8:00 AM,Right,5,7,,1,1.25,,\n"+ // sides only
		"7/9/26 9:00 AM,,,,,,,,only a note\n")
	type pump struct {
		start  time.Time
		length time.Duration
		amount string
		note   string
		family bool
	}
	var got []pump
	for _, pm := range p.Pumping {
		got = append(got, pump{pm.Start, pm.End.Sub(pm.Start), amountText(pm.Amount), pm.Note, pm.Family})
	}
	want := []pump{
		{utc("2026-07-07 23:04"), 10 * time.Minute, "3.5", "", true},
		{utc("2026-07-08 16:43"), 0, "2", "spilled some", true},
		{utc("2026-07-09 08:00"), 12 * time.Minute, "2.25", "", true},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("pumping\n got %v\nwant %v", got, want)
	}
	if notes := noteTexts(p); !reflect.DeepEqual(notes, []string{"Pumping: only a note"}) || p.AsNotes["Pump"] != 1 {
		t.Errorf("notes %v", notes)
	}
	if p.stats()["notes"] != 2 { // the note-only row, and the note on a session
		t.Errorf("stats %v", p.stats())
	}
}

func TestNighpBlankAndShortRows(t *testing.T) {
	p, _ := nighpPlan(t, nighpOpts("metric"), nighpOptions{}, "Rosa_diaper.csv",
		nighpDiaperCSV+",,,\n,,,\n,,,lost its time\nRosa,6/19/2026 7:00,Wet\n")
	if len(p.Changes) != 3 || p.RejectedCount != 2 {
		t.Fatalf("changes %d rejected %+v", len(p.Changes), p.Rejected)
	}
	first, second := at(t, p.Rejected, 0), at(t, p.Rejected, 1)
	if first.Code != "bad_start_time" || first.Line != 7 || first.Type != "Rosa_diaper.csv" || second.Code != "field_count" || second.Line != 8 {
		t.Errorf("rejected %+v", p.Rejected)
	}
}

func TestNighpOneBabyAtATime(t *testing.T) {
	files := []string{
		"Rosa_sleep.csv", nighpSleepCSV,
		"Leo_sleep.csv", "Baby,Time,Duration (min),Note\nLeo,7/20/2026 12:05,30,\n",
		"pump.csv", nighpPumpCSV,
	}
	_, _, err := nighpBuildPlan(nighpParse(t, files...), nighpOpts("metric"), nighpOptions{})
	var fe *importFileError
	if !errors.As(err, &fe) || fe.Code != "multiple_babies" || fe.Detail != "Leo, Rosa" {
		t.Fatalf("want multiple_babies, got %v", err)
	}
	if _, _, err := nighpBuildPlan(nighpParse(t, files...), nighpOpts("metric"), nighpOptions{Baby: "Mia"}); nighpFileErrorCode(t, err) != "unknown_baby" {
		t.Errorf("unknown baby: %v", err)
	}

	p, info := nighpPlan(t, nighpOpts("metric"), nighpOptions{Baby: "Leo"}, files...)
	// Leo's own sleep, plus the family's pumping.
	if len(p.Sleep) != 1 || len(p.Pumping) != 2 || p.Profile.Name != "Leo" || !reflect.DeepEqual(info.Babies, []string{"Leo", "Rosa"}) {
		t.Errorf("stats %v profile %+v babies %v", p.stats(), p.Profile, info.Babies)
	}
}

// nighpUpload builds a parsed multipart request holding the given files.
func nighpUpload(t *testing.T, path string, files map[string][]byte, order []string, fields map[string]string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, name := range order {
		fw, err := mw.CreateFormFile("file", name)
		if err != nil {
			t.Fatal(err)
		}
		fw.Write(files[name])
	}
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	mw.Close()
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func nighpZip(t *testing.T, entries ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for i := 0; i+1 < len(entries); i += 2 {
		w, err := zw.Create(entries[i])
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(entries[i+1]))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestNighpReadsZipsAndLooseFiles(t *testing.T) {
	archive := nighpZip(t,
		"export/Rosa_sleep.csv", nighpSleepCSV,
		"export/Rosa_diaper.csv", nighpDiaperCSV,
		"__MACOSX/export/._Rosa_sleep.csv", "junk",
		"export/readme.txt", "not a csv",
	)
	req := nighpUpload(t, "/", map[string][]byte{"export.zip": archive, "pump.csv": []byte(nighpPumpCSV)}, []string{"export.zip", "pump.csv"}, nil)
	if err := req.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	defer req.MultipartForm.RemoveAll()
	files, err := nighpReadFiles(req.MultipartForm.File["file"])
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, f := range files {
		got = append(got, f.name+":"+f.kind)
	}
	if want := []string{"Rosa_sleep.csv:sleep", "Rosa_diaper.csv:diaper", "pump.csv:pump"}; !reflect.DeepEqual(got, want) {
		t.Errorf("files %v, want %v", got, want)
	}

	if _, err := nighpReadFiles(nil); nighpFileErrorCode(t, err) != "invalid_upload" {
		t.Errorf("no files: %v", err)
	}
	broken := nighpUpload(t, "/", map[string][]byte{"export.zip": []byte("PK\x03\x04 not really a zip")}, []string{"export.zip"}, nil)
	if err := broken.ParseMultipartForm(1 << 20); err != nil {
		t.Fatal(err)
	}
	defer broken.MultipartForm.RemoveAll()
	if _, err := nighpReadFiles(broken.MultipartForm.File["file"]); nighpFileErrorCode(t, err) != "bad_zip" {
		t.Errorf("broken zip: %v", err)
	}
}

func TestNighpHandler(t *testing.T) {
	db := setupDB(t)
	h := NewNighpImportHandler(db, &config.Config{UnitSystem: "metric"})
	h.now = func() time.Time { return nighpNow }
	archive := nighpZip(t,
		"Rosa_sleep.csv", nighpSleepCSV,
		"Rosa_diaper.csv", nighpDiaperCSV,
		"Rosa_nursing.csv", nighpNursingCSV,
		"Rosa_expressed.csv", nighpExpressedCSV,
		"Rosa_growth.csv", nighpGrowthCSV,
		"pump.csv", nighpPumpCSV,
	)
	serve := func(t *testing.T, path string, upload []byte, fields map[string]string, admin bool) (int, map[string]any) {
		t.Helper()
		files, order := map[string][]byte{}, []string(nil)
		if upload != nil {
			files["export.zip"], order = upload, []string{"export.zip"}
		}
		req := nighpUpload(t, path, files, order, fields)
		req = req.WithContext(context.WithValue(req.Context(), middleware.IsAdminKey, admin))
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
	children := func(t *testing.T) int { return importCount(t, db, `SELECT count(*) FROM children`) }
	details := map[string]string{"first_name": "Rosa", "birth_date": "2026-06-16", "unit_system": "imperial", "timezone": "America/Chicago"}

	t.Run("preview saves nothing", func(t *testing.T) {
		code, out := serve(t, "/api/import/nighp-babytracker/preview", archive, map[string]string{"unit_system": "imperial"}, true)
		if code != http.StatusOK || importJSON[string](t, out, "status") != "preview" || children(t) != 0 {
			t.Fatalf("%d %v", code, out)
		}
		for key, want := range map[string]float64{
			"stats.sleep": 2, "stats.changes": 3, "stats.feedings": 4, "stats.weight": 2, "stats.height": 1,
			"stats.head_circumference": 1, "stats.pumping": 2, "stats.notes": 1, "rejected_count": 0,
		} {
			if got := importJSON[float64](t, out, key); got != want {
				t.Errorf("%s = %v, want %v", key, got, want)
			}
		}
		if importJSON[string](t, out, "profile.name") != "Rosa" || importJSON[string](t, out, "date_order") != "mdy" ||
			importJSON[bool](t, out, "date_order_assumed") || importJSON[string](t, out, "units.volume") != "oz" {
			t.Errorf("summary %v", out)
		}
	})

	t.Run("refusals", func(t *testing.T) {
		if code, _ := serve(t, "/api/import/nighp-babytracker/preview", archive, nil, false); code != http.StatusForbidden {
			t.Errorf("not an admin: %d", code)
		}
		if code, out := serve(t, "/api/import/nighp-babytracker/preview", nil, nil, true); code != http.StatusBadRequest || importJSON[string](t, out, "code") != "invalid_upload" {
			t.Errorf("no file: %d %v", code, out)
		}
		if code, out := serve(t, "/api/import/nighp-babytracker/preview", nighpZip(t, "a.csv", "x,y\n1,2\n"), nil, true); code != http.StatusBadRequest || importJSON[string](t, out, "code") != "not_nighp_export" {
			t.Errorf("not an export: %d %v", code, out)
		}
		if code, out := serve(t, "/api/import/nighp-babytracker/preview", archive, map[string]string{"date_order": "ymd"}, true); code != http.StatusBadRequest || importJSON[string](t, out, "code") != "invalid_upload" {
			t.Errorf("bad date order: %d %v", code, out)
		}
		if code, out := serve(t, "/api/import/nighp-babytracker", archive, map[string]string{"birth_date": "2026-06-16"}, true); code != http.StatusBadRequest || importJSON[string](t, out, "code") != "missing_name" {
			t.Errorf("no name: %d %v", code, out)
		}
		if children(t) != 0 {
			t.Errorf("a refused import created a child")
		}
	})

	t.Run("import", func(t *testing.T) {
		code, out := serve(t, "/api/import/nighp-babytracker", archive, details, true)
		if code != http.StatusOK || importJSON[string](t, out, "status") != "completed" {
			t.Fatalf("%d %v", code, out)
		}
		id := int(importJSON[float64](t, out, "child_id"))
		for query, want := range map[string]int{
			`SELECT count(*) FROM sleep WHERE child_id = $1`:    2,
			`SELECT count(*) FROM changes WHERE child_id = $1`:  3,
			`SELECT count(*) FROM feedings WHERE child_id = $1`: 4,
			`SELECT count(*) FROM pumping WHERE child_id = $1`:  2,
			`SELECT count(*) FROM weight WHERE child_id = $1`:   2,
			`SELECT count(*) FROM notes WHERE child_id = $1`:    1,
		} {
			if got := importCount(t, db, query, id); got != want {
				t.Errorf("%s = %d, want %d", query, got, want)
			}
		}
		// 17:16 in Chicago (UTC-5 in July), kept in ounces.
		var start time.Time
		var amount float64
		if err := db.QueryRow(`SELECT start_time, amount FROM feedings WHERE child_id = $1 AND method = 'bottle'`, id).Scan(&start, &amount); err != nil {
			t.Fatal(err)
		}
		if !start.Equal(utc("2026-07-19 22:16")) || amount != 2.5 {
			t.Errorf("bottle at %s, %v oz", start, amount)
		}
	})

	t.Run("a sibling's import leaves out the family pumping already saved", func(t *testing.T) {
		sibling := nighpZip(t,
			"Leo_sleep.csv", "Baby,Time,Duration (min),Note\nLeo,7/20/2026 12:05,30,\n",
			"pump.csv", nighpPumpCSV,
		)
		fields := map[string]string{"first_name": "Leo", "birth_date": "2026-06-16", "unit_system": "imperial", "timezone": "America/Chicago"}
		code, out := serve(t, "/api/import/nighp-babytracker", sibling, fields, true)
		if code != http.StatusOK || importJSON[float64](t, out, "stats.pumping") != 0 || importJSON[float64](t, out, "duplicate_pumping.count") != 2 {
			t.Fatalf("%d %v", code, out)
		}
	})
}
