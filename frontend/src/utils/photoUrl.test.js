import { describe, it, expect, afterEach, vi } from "vitest";
import { fullscreenPhotoUrl } from "./photoUrl";

function mockScreen(width, height, dpr = 1) {
  vi.stubGlobal("screen", { width, height });
  vi.stubGlobal("devicePixelRatio", dpr);
}

afterEach(() => vi.unstubAllGlobals());

describe("fullscreenPhotoUrl", () => {
  it("uses the medium preset on small displays", () => {
    mockScreen(800, 480);
    expect(fullscreenPhotoUrl("a.jpg")).toBe("./api/media/photos/a.jpg?size=medium");
  });

  it("uses the large preset on a 1080p display", () => {
    mockScreen(1920, 1080);
    expect(fullscreenPhotoUrl("a.jpg")).toBe("./api/media/photos/a.jpg?size=large");
  });

  it("accounts for devicePixelRatio", () => {
    // 960 CSS px at 2x = 1920 physical → large, not medium.
    mockScreen(960, 600, 2);
    expect(fullscreenPhotoUrl("a.jpg")).toBe("./api/media/photos/a.jpg?size=large");
  });

  it("falls back to the original beyond the largest preset", () => {
    mockScreen(3840, 2160);
    expect(fullscreenPhotoUrl("a.jpg")).toBe("./api/media/photos/a.jpg");
  });

  it("falls back to the original when screen info is unavailable", () => {
    vi.stubGlobal("screen", undefined);
    vi.stubGlobal("devicePixelRatio", undefined);
    expect(fullscreenPhotoUrl("a.jpg")).toBe("./api/media/photos/a.jpg");
  });
});
