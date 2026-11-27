// A phone tells a page how much room its status bar, notch and home bar take
// at the edges of the screen, and the app leaves that much room: above its
// header, below its bottom buttons. An iPhone tells a page inside a frame the
// very same figures, although that page does not reach those edges.
//
// Home Assistant shows the app in a frame: under its own header on a phone,
// and padded to stay clear of the screen's edges. So there the room was left
// twice, once by Home Assistant and once by the app, as an empty band at the
// top of the banner and a deeper one under the bottom buttons.
//
// The fix is to know how far in from each edge of the screen the page really
// is drawn, and to take that off the room it leaves. The --safe-* properties
// in styles.css do the sum, with --frame-* set from here.

const SIDES = ["top", "right", "bottom", "left"];

/**
 * How far in from each edge of the screen the page in `win` is drawn, in CSS
 * pixels: { top, right, bottom, left }, all 0 when the page is not in a frame.
 *
 * Only frames this page may look at are counted. Where a frame's position
 * cannot be read (the page around it comes from another address), counting
 * stops there, so a figure can be too small but never too large: the app may
 * then leave room it did not need, and never too little.
 */
export function frameOffsets(win = window) {
  const total = { top: 0, right: 0, bottom: 0, left: 0 };
  try {
    for (let w = win; w.parent && w.parent !== w; w = w.parent) {
      const frame = w.frameElement;
      if (!frame) break;
      const outer = w.parent;
      const box = frame.getBoundingClientRect();
      const style = outer.getComputedStyle(frame);
      const view = outer.document.documentElement;
      // The framed page is drawn in the frame's content box, inside its border
      // and its padding. Padding matters: it is how Home Assistant keeps the
      // frame clear of the screen's edges.
      const rim = (side) =>
        (parseFloat(style[`border${side}Width`]) || 0) + (parseFloat(style[`padding${side}`]) || 0);
      const hop = {
        top: box.top + rim("Top"),
        right: view.clientWidth - box.right + rim("Right"),
        bottom: view.clientHeight - box.bottom + rim("Bottom"),
        left: box.left + rim("Left"),
      };
      for (const side of SIDES) total[side] += hop[side];
    }
  } catch {
    // A frame we are not allowed to inspect: keep what was measured so far.
  }
  // A frame that runs past an edge of the page around it leaves nothing to
  // take off on that side.
  for (const side of SIDES) total[side] = Math.max(0, Math.round(total[side]));
  return total;
}

/**
 * Keeps --frame-top, --frame-right, --frame-bottom and --frame-left on the
 * page's root element equal to frameOffsets(), now and whenever the frame
 * changes size (turning the phone, or the page around it showing or hiding
 * its header). Does nothing for a page that is not framed. Returns a function
 * that stops it.
 */
export function watchFrameOffsets(win = window) {
  if (!win.parent || win.parent === win) return () => {};
  const root = win.document.documentElement;
  const apply = () => {
    const offsets = frameOffsets(win);
    for (const side of SIDES) root.style.setProperty(`--frame-${side}`, `${offsets[side]}px`);
  };
  apply();
  win.addEventListener("resize", apply);
  win.addEventListener("pageshow", apply);
  return () => {
    win.removeEventListener("resize", apply);
    win.removeEventListener("pageshow", apply);
  };
}
