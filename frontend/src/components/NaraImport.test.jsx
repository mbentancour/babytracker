import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

const summary = (over = {}) => ({
  stats: stats({ feedings: 3 }),
  units: { volume: "mL", weight: "kg", length: "cm", temperature: "°C" },
  skipped: {}, as_notes: {}, duplicate_pumping: { count: 0, children: [] }, solid_feeds: 0,
  rejected: [], rejected_count: 0, warnings: [], warning_count: 0,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

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
    api.previewNaraImport.mockResolvedValue(summary({ profile: { name: "Rosa", birth_date: "2026-08-09" } }));
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

  it("shows translated errors, including ones without a server code", async () => {
    api.previewNaraImport.mockRejectedValueOnce({ error: "this file doesn't look like a Nara Baby export", code: "not_nara_export", status: 400 });
    renderImport();
    pick("other.csv");
    expect((await screen.findByRole("alert")).textContent).toMatch(/doesn't look like a Nara Baby export/);

    api.previewNaraImport.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    pick("rosa.csv");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/connection was interrupted/));

    api.previewNaraImport.mockRejectedValueOnce({ error: "<html>Bad gateway</html>", status: 502 });
    pick("rosa.csv");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The import failed. Try again."));
  });

  it("offers to import family pumping that's already in BabyTracker", async () => {
    api.previewNaraImport.mockResolvedValue(summary({
      stats: stats(), duplicate_pumping: { count: 4, children: ["Ana"] },
      profile: { name: "Bo", birth_date: "2026-08-09" },
    }));
    api.importFromNara.mockResolvedValue({ ...summary(), status: "completed" });
    renderImport();
    pick("bo.csv");

    // Only the duplicates are importable, so Start Import waits for the box.
    const start = await screen.findByRole("button", { name: "Start Import" });
    expect(start.disabled).toBe(true);
    expect(screen.getByText(/already in BabyTracker with Ana/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Also import those family pumping sessions (4) for this baby"));
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await screen.findByText("Import Complete!");
    expect(api.importFromNara).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ includeDuplicates: true }));
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
});
