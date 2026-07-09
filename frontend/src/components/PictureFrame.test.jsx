import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import PictureFrame from "./PictureFrame";
import { I18nProvider } from "../utils/i18n";
import { PreferencesProvider } from "../utils/preferences";

// Record every Image preload the component kicks off.
let preloaded;

beforeEach(() => {
  preloaded = [];
  vi.stubGlobal(
    "Image",
    class {
      set src(value) {
        preloaded.push(value);
      }
    },
  );
  // Deterministic quality selection: a 1080p screen resolves to "large".
  vi.stubGlobal("screen", { width: 1920, height: 1080 });
  vi.stubGlobal("devicePixelRatio", 1);
  // jsdom has no matchMedia; the status overlay queries orientation on mount.
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PHOTOS = [
  { photo: "a.jpg", label: "A", date: "2026-01-01" },
  { photo: "b.jpg", label: "B", date: "2026-01-02" },
];

function renderFrame(photos = PHOTOS) {
  return render(
    <I18nProvider>
      <PreferencesProvider>
        <PictureFrame photos={photos} onWake={() => {}} />
      </PreferencesProvider>
    </I18nProvider>,
  );
}

describe("PictureFrame preloading", () => {
  it("preloads the next slide, not the one being displayed", () => {
    const { container } = renderFrame();
    const displayed = container
      .querySelector(".picture-frame-image")
      .style.backgroundImage;

    expect(preloaded).toHaveLength(1);
    // The preload uses the same sized-rendition URL scheme as display.
    expect(preloaded[0]).toMatch(/\?size=large$/);
    // With two photos, the preloaded one must be the slide NOT on screen.
    expect(displayed).not.toContain(preloaded[0]);
  });

  it("does not preload with a single photo", () => {
    renderFrame([PHOTOS[0]]);
    expect(preloaded).toHaveLength(0);
  });
});
