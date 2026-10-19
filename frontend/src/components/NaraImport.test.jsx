import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { I18nProvider } from "../utils/i18n";

vi.mock("../api", () => ({
  api: { previewNaraImport: vi.fn(), importFromNara: vi.fn() },
}));

const { api } = await import("../api");
const { default: NaraImport } = await import("./NaraImport");

const stats = (over = {}) => ({
  feedings: 0, sleep: 0, changes: 0, pumping: 0, weight: 0, height: 0, head_circumference: 0,
  temperature: 0, medications: 0, milestones: 0, notes: 0, ...over,
});

const IMPERIAL = { volume: "oz", weight: "lb", length: "in", temperature: "°F" };

const summary = (over = {}) => ({
  stats: stats({ feedings: 3 }),
  units: { volume: "mL", weight: "kg", length: "cm", temperature: "°C" },
  skipped: {}, as_notes: {}, duplicate_pumping: { count: 0, children: [] }, solid_feeds: 0,
  rejected: [], rejected_count: 0, warnings: [], warning_count: 0,
  ...over,
});

const ROSA = { name: "Rosa", birth_date: "2026-08-09" };

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Lets a settled promise's continuation (and the renders it causes) run.
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

// Without onUnitsChange there's no unit choice, as in Settings → Data.
function renderImport(props = {}) {
  return render(
    <I18nProvider>
      <NaraImport unitSystem="metric" onBack={() => {}} {...props} />
    </I18nProvider>,
  );
}

function pick(name) {
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "text/csv" })] } });
}

describe("NaraImport", () => {
  it("prefills the baby from the export and follows a newly picked export", async () => {
    api.previewNaraImport
      .mockResolvedValueOnce(summary({ profile: { name: "Rosa", birth_date: "2026-08-09", sex: "female" } }))
      .mockResolvedValueOnce(summary({ profile: { name: "Theo", birth_date: "2025-01-02", sex: "male" } }));
    renderImport();

    pick("rosa.csv");
    await waitFor(() => expect(screen.getByLabelText("First Name").value).toBe("Rosa"));
    expect(screen.getByLabelText("First Name").required).toBe(true);
    expect(screen.getByLabelText("Birth Date").value).toBe("2026-08-09");
    expect(screen.getByLabelText("Sex").value).toBe("female");

    // A field the user edited is kept; the others follow the new export.
    fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Rosie" } });
    pick("theo.csv");
    await waitFor(() => expect(screen.getByLabelText("Birth Date").value).toBe("2025-01-02"));
    expect(screen.getByLabelText("First Name").value).toBe("Rosie");
    expect(screen.getByLabelText("Sex").value).toBe("male");
  });

  it("previews and imports in the chosen units, then saves that choice for the device", async () => {
    api.previewNaraImport.mockResolvedValue(summary({ profile: ROSA }));
    api.importFromNara.mockResolvedValue({ ...summary(), status: "completed", child_id: 7 });
    const onUnitsChange = vi.fn();
    renderImport({ onUnitsChange });

    pick("rosa.csv");
    await waitFor(() => expect(api.previewNaraImport).toHaveBeenCalledWith(expect.any(File), "metric"));
    fireEvent.change(screen.getByLabelText("Save amounts in"), { target: { value: "imperial" } });
    await waitFor(() => expect(api.previewNaraImport).toHaveBeenLastCalledWith(expect.any(File), "imperial"));
    await screen.findByLabelText("First Name");

    fireEvent.click(screen.getByRole("button", { name: "Start Import" }));
    await screen.findByText("Import Complete!");
    expect(api.importFromNara).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ unitSystem: "imperial", firstName: "Rosa" }));
    expect(onUnitsChange).toHaveBeenCalledWith("imperial");
  });

  it("starts the unit choice at the device's setting", () => {
    renderImport({ unitSystem: "imperial", onUnitsChange: vi.fn() });
    expect(screen.getByLabelText("Save amounts in").value).toBe("imperial");
  });

  // Other babies' amounts are labelled with the device's units, so a baby
  // added from Settings is saved in them too.
  it("saves amounts in the device's units when it offers no unit choice", async () => {
    api.previewNaraImport.mockResolvedValue(summary({ units: IMPERIAL, profile: ROSA }));
    api.importFromNara.mockResolvedValue({ ...summary({ units: IMPERIAL }), status: "completed" });
    renderImport({ unitSystem: "imperial" });

    pick("rosa.csv");
    await screen.findByText("Amounts are saved in oz, lb, in and °F.");
    expect(screen.queryByLabelText("Save amounts in")).toBeNull();
    expect(api.previewNaraImport).toHaveBeenCalledWith(expect.any(File), "imperial");
    fireEvent.click(screen.getByRole("button", { name: "Start Import" }));
    await screen.findByText("Import Complete!");
    expect(api.importFromNara).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ unitSystem: "imperial" }));
  });

  it("ignores a preview that a newer one overtook", async () => {
    const metric = deferred();
    const imperial = deferred();
    api.previewNaraImport.mockReturnValueOnce(metric.promise).mockReturnValueOnce(imperial.promise);
    renderImport({ onUnitsChange: vi.fn() });

    pick("rosa.csv");
    fireEvent.change(screen.getByLabelText("Save amounts in"), { target: { value: "imperial" } });
    expect(screen.getByText("Reading the export…")).toBeTruthy();

    // The imperial preview answers first, and the late metric one mustn't
    // replace it: the select says imperial, so the import will be too.
    imperial.resolve(summary({ units: IMPERIAL, profile: { name: "Imp", birth_date: "2026-08-09" } }));
    await waitFor(() => expect(screen.getByLabelText("First Name").value).toBe("Imp"));
    metric.resolve(summary({ profile: { name: "Met", birth_date: "2025-01-02" } }));
    await settle();

    expect(screen.getByLabelText("First Name").value).toBe("Imp");
    expect(screen.getByText("Amounts are saved in oz, lb, in and °F.")).toBeTruthy();
    expect(screen.getByLabelText("Save amounts in").value).toBe("imperial");
    expect(screen.queryByText("Reading the export…")).toBeNull();
  });

  it("drops the old preview while a new file is read, and ignores an older pick's error", async () => {
    const bad = deferred();
    const theo = deferred();
    api.previewNaraImport
      .mockResolvedValueOnce(summary({ profile: ROSA }))
      .mockReturnValueOnce(bad.promise)
      .mockReturnValueOnce(theo.promise);
    renderImport();

    pick("rosa.csv");
    await screen.findByText("In this export:");
    pick("bad.csv");
    expect(screen.queryByText("In this export:")).toBeNull();
    expect(screen.getByText("Reading the export…")).toBeTruthy();

    // The older pick fails while the newer one is still being read.
    pick("theo.csv");
    bad.reject({ error: "this file doesn't look like a Nara Baby export", code: "not_nara_export", status: 400 });
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Reading the export…")).toBeTruthy();
    expect(screen.getByText("theo.csv")).toBeTruthy();

    theo.resolve(summary({ profile: { name: "Theo", birth_date: "2025-01-02" } }));
    await waitFor(() => expect(screen.getByLabelText("First Name").value).toBe("Theo"));
    expect(screen.queryByText("Reading the export…")).toBeNull();
  });

  it("holds the screen until the summary is dismissed, then hands over the result", async () => {
    api.previewNaraImport.mockResolvedValue(summary({ profile: ROSA }));
    const result = { ...summary(), status: "completed", child_id: 7 };
    api.importFromNara.mockResolvedValue(result);
    const onBusy = vi.fn();
    const onDone = vi.fn();
    renderImport({ onBusy, onDone, doneLabel: "Done" });

    pick("rosa.csv");
    fireEvent.click(await screen.findByRole("button", { name: "Start Import" }));
    const heading = await screen.findByRole("heading", { name: "Import Complete!" });
    // The form is gone, so focus moves to the result (which also announces it).
    expect(document.activeElement).toBe(heading);
    expect(onBusy.mock.calls).toEqual([[true]]);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false));
    expect(onDone).toHaveBeenCalledWith(result);
  });

  it("releases the hold if it goes away with the summary on screen", async () => {
    api.previewNaraImport.mockResolvedValue(summary({ profile: ROSA }));
    api.importFromNara.mockResolvedValue({ ...summary(), status: "completed" });
    const onBusy = vi.fn();
    const { unmount } = renderImport({ onBusy });

    pick("rosa.csv");
    fireEvent.click(await screen.findByRole("button", { name: "Start Import" }));
    await screen.findByText("Import Complete!");
    unmount();
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });

  it("releases the hold and allows another try when the import fails", async () => {
    api.previewNaraImport.mockResolvedValue(summary({ profile: ROSA }));
    api.importFromNara
      .mockRejectedValueOnce({ error: "import failed", code: "import_failed", status: 500 })
      .mockResolvedValueOnce(null);
    const onBusy = vi.fn();
    renderImport({ onBusy });

    pick("rosa.csv");
    fireEvent.click(await screen.findByRole("button", { name: "Start Import" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The import failed and nothing was saved. Try again.");
    expect(onBusy.mock.calls).toEqual([[true], [false]]);
    const start = screen.getByRole("button", { name: "Start Import" });
    expect(start.disabled).toBe(false);

    // An empty answer isn't a finished import either.
    fireEvent.click(start);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The import failed. Try again."));
    expect(screen.queryByText("Import Complete!")).toBeNull();
  });

  it("shows translated errors, including ones without a server code", async () => {
    api.previewNaraImport.mockRejectedValueOnce({ error: "this file doesn't look like a Nara Baby export", code: "not_nara_export", status: 400 });
    renderImport();
    pick("other.csv");
    // The translation, not the server's English text.
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This file doesn't look like a Nara Baby export. In Nara, use Export Data and upload the CSV file it creates.",
    );

    api.previewNaraImport.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    pick("rosa.csv");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/connection was interrupted/));

    api.previewNaraImport.mockRejectedValueOnce({ error: "<html>Bad gateway</html>", status: 502 });
    pick("rosa.csv");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The import failed. Try again."));
  });

  it("explains size, session and timeout errors", async () => {
    renderImport();
    const cases = [
      // The server's own 413 names its limit.
      [{ error: "file too large", code: "too_large", detail: "50", status: 413 }, "The file is larger than the 50 MB upload limit."],
      // A proxy's 413 (an HTML page) has a limit of its own we can't know.
      [{ error: "<html><h1>413 Request Entity Too Large</h1></html>", status: 413 }, "The file is too large for the server, or a proxy in front of it, to accept."],
      [{ error: "unauthorized", status: 401 }, "Your session has expired. Sign in again, then retry the import."],
      [new Error("Request timed out after 600000ms: ./api/import/nara/preview"), "The connection was interrupted. Check it and try again."],
    ];
    for (const [err, text] of cases) {
      api.previewNaraImport.mockRejectedValueOnce(err);
      pick("rosa.csv");
      await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(text));
    }
  });

  it("summarises the export, with what it saved differently or assumed", async () => {
    api.previewNaraImport.mockResolvedValue(summary({
      stats: stats({ feedings: 2, sleep: 3 }),
      solid_feeds: 1,
      as_notes: { "Dry diaper": 2 },
      skipped: { "Postpartum Mood": 1 },
      warnings: [
        { line: 5, type: "Feed", code: "milk_type_unknown", reason: "milk type not recorded" },
        { line: 6, type: "Feed", code: "a_newer_code", reason: "the server's own words" },
      ],
      warning_count: 2,
      profile: ROSA,
    }));
    renderImport();

    pick("rosa.csv");
    await screen.findByText("Amounts are saved in mL, kg, cm and °C.");
    expect(screen.getByText(/sleeps that start between 7 am and 7 pm and last under 4 hours are saved as naps/)).toBeTruthy();
    expect(screen.getByText(/solid feeds are saved as "Parent Fed"/)).toBeTruthy();
    expect(screen.getByText("Saved as notes: Dry diaper (2)")).toBeTruthy();
    expect(screen.getByText("Not imported: Postpartum Mood (1)")).toBeTruthy();
    expect(screen.getByText("Imported with an assumption: 2")).toBeTruthy();
    expect(screen.getByText("Line 5 (Feed): milk type not recorded; saved as breast milk")).toBeTruthy();
    // A code this version doesn't translate falls back to the server's reason.
    expect(screen.getByText("Line 6 (Feed): the server's own words")).toBeTruthy();
  });

  it("says when nothing in the export can be imported", async () => {
    api.previewNaraImport.mockResolvedValue(summary({ stats: stats(), profile: ROSA }));
    renderImport();

    pick("empty.csv");
    await screen.findByText("Nothing in this file can be imported.");
    expect(screen.queryByRole("button", { name: "Start Import" })).toBeNull();
    expect(screen.queryByLabelText("First Name")).toBeNull();
  });

  it("offers to import family pumping already saved for another baby", async () => {
    api.previewNaraImport.mockResolvedValue(summary({
      stats: stats(), duplicate_pumping: { count: 4, children: ["Ana"] },
      profile: { name: "Bo", birth_date: "2026-08-09" },
    }));
    api.importFromNara.mockResolvedValue({
      ...summary({ stats: stats({ pumping: 4 }) }),
      duplicate_pumping: { count: 4, children: ["Ana"], included: true },
      status: "completed",
    });
    renderImport();
    pick("bo.csv");

    // A sibling's sessions start unticked, and they're all there is to
    // import, so Start Import waits for the box.
    const start = await screen.findByRole("button", { name: "Start Import" });
    const box = screen.getByLabelText("Also import those family pumping sessions (4) for this baby");
    expect(box.checked).toBe(false);
    expect(start.disabled).toBe(true);
    expect(screen.getByText("Family pumping sessions already saved for Ana won't be imported again: 4.")).toBeTruthy();

    fireEvent.click(box);
    expect(start.disabled).toBe(false);
    expect(screen.getByText("Family pumping sessions already saved for Ana will be imported for this baby too: 4.")).toBeTruthy();

    fireEvent.click(start);
    await screen.findByText("Import Complete!");
    expect(api.importFromNara).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ includeDuplicates: true }));
    expect(screen.getByText("Family pumping sessions already saved for Ana were imported for this baby too: 4.")).toBeTruthy();
  });

  // Same name: most likely the same baby again, say after a trial import
  // that will be deleted along with its pumping.
  it("ticks the box for a baby with the same name, unless the user unticks it", async () => {
    api.previewNaraImport.mockResolvedValue(summary({
      duplicate_pumping: { count: 3, children: ["Ana", "Emma"] },
      profile: { name: "emma", birth_date: "2026-08-09" },
    }));
    api.importFromNara.mockResolvedValue({
      ...summary(),
      duplicate_pumping: { count: 3, children: ["Ana", "Emma"], included: false },
      status: "completed",
    });
    renderImport();
    pick("emma.csv");

    const box = await screen.findByLabelText("Also import those family pumping sessions (3) for this baby");
    expect(box.checked).toBe(true);
    // Several names are listed the way the language does.
    expect(screen.getByText("Family pumping sessions already saved for Ana and Emma will be imported for this baby too: 3.")).toBeTruthy();

    // The user's choice sticks when the name changes.
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "Emma" } });
    expect(box.checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Start Import" }));
    await screen.findByText("Import Complete!");
    expect(api.importFromNara).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ includeDuplicates: false }));
    expect(screen.getByText("Family pumping sessions already saved for Ana and Emma weren't imported again: 3.")).toBeTruthy();
  });

  it("follows the name typed in the form until the box is touched, and again for a new pick", async () => {
    api.previewNaraImport.mockResolvedValue(summary({ duplicate_pumping: { count: 2, children: ["Emma"] }, profile: {} }));
    renderImport();
    pick("export.csv");

    const box = await screen.findByLabelText("Also import those family pumping sessions (2) for this baby");
    expect(box.checked).toBe(false);
    fireEvent.change(screen.getByLabelText("First Name"), { target: { value: " emma " } });
    expect(box.checked).toBe(true);

    fireEvent.click(box);
    expect(box.checked).toBe(false);
    pick("export.csv");
    await waitFor(() => expect(screen.getByLabelText("Also import those family pumping sessions (2) for this baby").checked).toBe(true));
  });

  it("lists issues with translated reasons and says when the list is cut short", async () => {
    api.previewNaraImport.mockResolvedValue(summary({
      rejected: [{ line: 4, type: "Diaper", code: "unknown_diaper_type", detail: "[Diaper] Type", value: "Sparkly $&", reason: "x" }],
      rejected_count: 51,
      profile: {},
    }));
    renderImport();
    pick("rosa.csv");
    await screen.findByText("Entries that couldn't be read: 51");
    expect(screen.getByText('Line 4 (Diaper): unrecognized diaper type "Sparkly $&"')).toBeTruthy();
    expect(screen.getByText("…and 50 more")).toBeTruthy();
  });

  it("words a count of one correctly", async () => {
    localStorage.setItem("babytracker_locale", "it");
    api.previewNaraImport.mockResolvedValue(summary({
      rejected: [{ line: 3, type: "Diaper", code: "field_count", detail: "42", value: "1", reason: "x" }],
      rejected_count: 2,
      profile: {},
    }));
    renderImport();
    pick("rosa.csv");
    await screen.findByText("Registrazioni non leggibili: 2");
    expect(screen.getByText("Riga 3 (Diaper): la riga ha 1 invece di 42 colonne")).toBeTruthy();
    expect(screen.getByText("…e un'altra")).toBeTruthy();
  });
});
