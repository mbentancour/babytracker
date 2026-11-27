import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { frameOffsets, watchFrameOffsets } from "./frameOffset";

const SIDES = ["Top", "Right", "Bottom", "Left"];

// A page as the code sees it: a window with a viewport of the given size. One
// that is not in a frame is its own parent, and its viewport is the screen.
function page({ width = 402, height = 874, inside = null, frame = null } = {}) {
  const win = {
    frameElement: frame,
    document: { documentElement: { clientWidth: width, clientHeight: height } },
    getComputedStyle: (element) => element.style,
  };
  win.parent = inside || win;
  return win;
}

// The <iframe> element a page sits in, as the page around it sees it: where
// its box is, and its border and padding.
function frame({ top = 0, left = 0, width = 402, height = 874, padding = {}, border = 0 } = {}) {
  const style = {};
  for (const side of SIDES) {
    style[`border${side}Width`] = `${border}px`;
    style[`padding${side}`] = `${padding[side.toLowerCase()] || 0}px`;
  }
  return { style, getBoundingClientRect: () => ({ top, left, right: left + width, bottom: top + height }) };
}

const framedIn = (outer, element) => page({ inside: outer, frame: element });

describe("frameOffsets", () => {
  it("is 0 on every side for a page that is not in a frame", () => {
    expect(frameOffsets(page())).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("measures Home Assistant on an iPhone: under its header, padded clear of the home bar", () => {
    // A 59 px status bar and a 40 px header; the frame runs to the bottom of
    // the screen and is padded by the 34 px the home bar takes.
    const element = frame({ top: 99, height: 775, padding: { bottom: 34 } });
    expect(frameOffsets(framedIn(page(), element))).toEqual({ top: 99, right: 0, bottom: 34, left: 0 });
  });

  it("counts padding at the top, as Home Assistant uses on a wide screen with no header", () => {
    const element = frame({ padding: { top: 24, bottom: 20 } });
    expect(frameOffsets(framedIn(page(), element))).toMatchObject({ top: 24, bottom: 20 });
  });

  it("takes nothing off an edge the frame does reach", () => {
    // An older Home Assistant: a 40 px header and no padding anywhere.
    const element = frame({ top: 40, height: 834 });
    expect(frameOffsets(framedIn(page(), element))).toEqual({ top: 40, right: 0, bottom: 0, left: 0 });
  });

  it("measures the sides: a frame beside a sidebar", () => {
    const screen = page({ width: 956, height: 440 });
    const element = frame({ left: 256, width: 638, height: 440, padding: { right: 62 } });
    expect(frameOffsets(framedIn(screen, element))).toMatchObject({ left: 256, right: 62 + 62 });
  });

  it("counts the frame's own border", () => {
    const element = frame({ top: 100, height: 774, border: 2 });
    expect(frameOffsets(framedIn(page(), element))).toEqual({ top: 102, right: 2, bottom: 2, left: 2 });
  });

  it("adds up frames inside frames", () => {
    const outer = page({ height: 775, inside: page(), frame: frame({ top: 99, height: 775 }) });
    const inner = framedIn(outer, frame({ top: 40, height: 700 }));
    expect(frameOffsets(inner)).toEqual({ top: 139, right: 0, bottom: 35, left: 0 });
  });

  it("is 0 when the page around it comes from another address", () => {
    // The browser hides the frame element from a page of another origin.
    expect(frameOffsets(framedIn(page(), null))).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("counts what it can see when an outer frame is hidden from it", () => {
    const outer = page({ height: 700, inside: page(), frame: null });
    const inner = framedIn(outer, frame({ top: 40, height: 660 }));
    expect(frameOffsets(inner)).toMatchObject({ top: 40, bottom: 0 });
  });

  it("keeps what it measured when looking further is refused", () => {
    const outer = page({ height: 700, inside: page() });
    Object.defineProperty(outer, "frameElement", {
      get() {
        throw new Error("SecurityError");
      },
    });
    const inner = framedIn(outer, frame({ top: 40, height: 660 }));
    expect(frameOffsets(inner)).toMatchObject({ top: 40, bottom: 0 });
  });

  it("is never negative: a frame that runs past the page leaves nothing to take off", () => {
    const element = frame({ top: -300, height: 2000 });
    expect(frameOffsets(framedIn(page(), element))).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("rounds to whole pixels", () => {
    const element = frame({ top: 98.6, height: 775.4 });
    expect(frameOffsets(framedIn(page(), element))).toMatchObject({ top: 99, bottom: 0 });
  });
});

describe("watchFrameOffsets", () => {
  // A framed window with a real root element, whose frame can be moved.
  function framedWindow(element) {
    const listeners = {};
    const win = framedIn(page(), element);
    win.document = { documentElement: document.createElement("html") };
    win.addEventListener = (type, fn) => {
      listeners[type] = fn;
    };
    win.removeEventListener = (type, fn) => {
      if (listeners[type] === fn) delete listeners[type];
    };
    const value = (side) => win.document.documentElement.style.getPropertyValue(`--frame-${side}`);
    return { win, listeners, value };
  }

  it("tells the stylesheet where the frame is, on every side", () => {
    const { win, value } = framedWindow(frame({ top: 99, height: 775, padding: { bottom: 34 } }));
    watchFrameOffsets(win);
    expect(["top", "right", "bottom", "left"].map(value)).toEqual(["99px", "0px", "34px", "0px"]);
  });

  it("follows the frame when it changes size", () => {
    const { win, listeners, value } = framedWindow(frame({ top: 99, height: 775, padding: { bottom: 34 } }));
    watchFrameOffsets(win);
    // The phone is turned: no status bar at the top, a lower home bar.
    win.frameElement = frame({ top: 40, width: 874, height: 362, padding: { bottom: 21 } });
    win.parent.document.documentElement.clientWidth = 874;
    win.parent.document.documentElement.clientHeight = 402;
    listeners.resize();
    expect(["top", "bottom"].map(value)).toEqual(["40px", "21px"]);
  });

  it("stops when asked to", () => {
    const { win, listeners } = framedWindow(frame({ top: 99, height: 775 }));
    const stop = watchFrameOffsets(win);
    expect(Object.keys(listeners).sort()).toEqual(["pageshow", "resize"]);
    stop();
    expect(listeners).toEqual({});
  });

  it("leaves a page that is not framed alone", () => {
    const win = page();
    win.document = { documentElement: document.createElement("html") };
    win.addEventListener = () => {
      throw new Error("should not listen");
    };
    watchFrameOffsets(win);
    expect(win.document.documentElement.getAttribute("style")).toBeNull();
  });
});

describe("the stylesheets", () => {
  // A rule that reads the phone's figure directly leaves the room twice
  // inside Home Assistant, and no desktop browser will show it.
  //
  // Read from disk: the test runner hands back an empty string for an
  // imported stylesheet, which would make these checks pass on nothing.
  function stylesheets(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return stylesheets(path);
      return entry.name.endsWith(".css") ? [[path, readFileSync(path, "utf8")]] : [];
    });
  }
  const sheets = stylesheets(join(dirname(fileURLToPath(import.meta.url)), ".."));
  const isDefinition = (line) => /^--safe-(top|right|bottom|left):/.test(line.trimStart());

  it("are all found and not empty", () => {
    expect(sheets.length).toBeGreaterThanOrEqual(3);
    for (const [file, css] of sheets) expect(css.length, file).toBeGreaterThan(100);
  });

  it("leave room at the edges of the screen only through the --safe-* properties", () => {
    const direct = sheets.flatMap(([file, css]) =>
      css
        .split("\n")
        .filter((line) => line.includes("env(safe-area-inset-") && !isDefinition(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(direct).toEqual([]);
  });

  it("define each --safe-* property once, from the phone's figure and the frame's position", () => {
    const definitions = sheets.flatMap(([, css]) => css.split("\n")).filter(isDefinition);
    expect(definitions).toHaveLength(4);
    for (const side of ["top", "right", "bottom", "left"]) {
      const mine = definitions.filter((line) => line.trimStart().startsWith(`--safe-${side}:`));
      expect(mine, side).toHaveLength(1);
      expect(mine[0]).toContain(`env(safe-area-inset-${side}, 0px)`);
      expect(mine[0]).toContain(`var(--frame-${side}, 0px)`);
    }
  });
});
