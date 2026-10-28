import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { I18nProvider } from "../utils/i18n";

vi.mock("../api", () => ({
  api: { importFromBabyBuddy: vi.fn(), previewNaraImport: vi.fn(), importFromNara: vi.fn() },
}));

const { api } = await import("../api");
const { default: OnboardingScreen } = await import("./OnboardingScreen");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

function renderOnboarding(props) {
  return render(
    <I18nProvider>
      <OnboardingScreen onChildAdded={() => {}} {...props} />
    </I18nProvider>,
  );
}

describe("OnboardingScreen", () => {
  it("keeps Baby Buddy's Back disabled until the import's summary is dismissed", async () => {
    let finish;
    api.importFromBabyBuddy.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const onBusy = vi.fn();
    const onChildAdded = vi.fn();
    renderOnboarding({ initialMode: "import", onBusy, onChildAdded });

    fireEvent.change(screen.getByPlaceholderText("http://192.168.1.100:8000"), { target: { value: "http://bb.local" } });
    fireEvent.change(screen.getByPlaceholderText("From Baby Buddy Settings > API Key"), { target: { value: "token" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Import" }));
    // Leaving mid-import would drop the summary the import is about to show.
    expect(screen.getByRole("button", { name: "Back" }).disabled).toBe(true);
    expect(onBusy).toHaveBeenLastCalledWith(true);

    await act(async () => finish({ stats: { feedings: 2 } }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Dashboard" }));
    await act(() => Promise.resolve());
    expect(onChildAdded).toHaveBeenCalled();
    expect(onBusy).toHaveBeenLastCalledWith(false);
  });

  // First run has no other babies yet, so the Nara import offers a choice.
  it("offers the Nara import's unit choice, starting at the device's setting", () => {
    renderOnboarding({ initialMode: "nara", unitSystem: "imperial", onUnitSystemChange: vi.fn() });
    expect(screen.getByLabelText("Save amounts in").value).toBe("imperial");
  });
});
