import { Children, isValidElement, useLayoutEffect, useRef, useState } from "react";
import { usePreferences } from "../utils/preferences";
import { useI18n } from "../utils/i18n";

const list = (value) => (Array.isArray(value) ? value : []);

// arrange puts the cards a grid has right now (`ids`, in their built-in order)
// into the order saved for it and separates the hidden ones. `saved` is
// { order: [ids], hidden: [ids] }, or nothing when the grid was never touched.
//
// The saved lists may name cards the grid does not have at the moment — a
// graph that only appears while there is data for it, a feature that is
// switched off — and `order` keeps those, so they are where they were when
// they come back. A card the saved order has never seen (it turned up later,
// or came with a newer version) goes right after the last of the cards it
// follows in the built-in order, wherever those have been moved to: beside the
// ones it was designed to sit with, or failing that further down, but never in
// front of something it was meant to come after.
export function arrange(ids, saved) {
  const order = [...new Set(list(saved?.order))];
  ids.forEach((id, index) => {
    if (order.includes(id)) return;
    const lastBefore = Math.max(-1, ...ids.slice(0, index).map((other) => order.indexOf(other)));
    order.splice(lastBefore + 1, 0, id);
  });
  const present = order.filter((id) => ids.includes(id));
  const hiding = new Set(list(saved?.hidden));
  return {
    order,
    visible: present.filter((id) => !hiding.has(id)),
    hidden: present.filter((id) => hiding.has(id)),
  };
}

// moved is the saved arrangement after a card has swapped places with the
// visible card next to it (`step` -1 for the one before, 1 for the one after).
// Hidden and absent cards stay where they are. At either end there is nothing
// to swap with and `saved` comes back as it was.
export function moved(ids, saved, id, step) {
  const { order, visible } = arrange(ids, saved);
  const at = visible.indexOf(id);
  const other = at === -1 ? undefined : visible[at + step];
  if (other === undefined) return saved;
  const next = [...order];
  const [a, b] = [next.indexOf(id), next.indexOf(other)];
  [next[a], next[b]] = [next[b], next[a]];
  return { order: next, hidden: list(saved?.hidden) };
}

// withHidden is the saved arrangement with one card hidden, or shown again.
// It leaves the order alone: hiding a card is not choosing an order, so a grid
// where cards were only hidden keeps following the built-in one.
export function withHidden(saved, id, hide) {
  const others = list(saved?.hidden).filter((other) => other !== id);
  return { order: list(saved?.order), hidden: hide ? [...others, id] : others };
}

// isArranged says whether the grid looks any different from its built-in
// arrangement — whether there is something for Reset to undo.
export function isArranged(ids, saved) {
  const { visible, hidden } = arrange(ids, saved);
  return hidden.length > 0 || visible.some((id, index) => id !== ids[index]);
}

// Points left; `turn` degrees clockwise makes it up (90), right (180) or down (270).
function Arrow({ turn }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: `rotate(${turn}deg)` }}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

// ArrangeSlot is one card of an ArrangeGrid: `id` is what its place is saved
// under, `title` what it is called while the grid is being arranged.
export function ArrangeSlot({ className, children }) {
  return <div className={className}>{children}</div>;
}

// ArrangeGrid is a grid of cards that whoever is looking at it can put in
// their own order and thin out. Its children are ArrangeSlots; `style` lays
// the grid out. A Customize button above it turns each card into a small tile
// that can be moved earlier or later, or hidden; hidden cards wait underneath
// to be brought back. `hint` says what is being arranged, in the caller's
// words. The arrangement is kept in this device's preferences under
// `layoutKey`, like the other choices about what a screen shows.
export function ArrangeGrid({ layoutKey, hint, style, children }) {
  const { t } = useI18n();
  const { prefs, setPref } = usePreferences();
  const [arranging, setArranging] = useState(false);
  const [stacked, setStacked] = useState(false);
  const grid = useRef(null);

  const slots = Children.toArray(children).filter((child) => isValidElement(child) && child.props.id);
  const ids = slots.map((slot) => slot.props.id);
  const saved = prefs.layouts?.[layoutKey];
  const { visible, hidden } = arrange(ids, saved);

  // "Earlier" is to the left while the tiles sit side by side and up once the
  // grid is down to a single column. Only the grid knows which it is — that
  // depends on the caller's `style` and the room there is — so it is measured.
  useLayoutEffect(() => {
    const element = grid.current;
    if (!arranging || !element) return undefined;
    const measure = () => {
      const [first, second] = element.children;
      setStacked(Boolean(second) && second.offsetTop > first.offsetTop);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [arranging, visible.length]);

  if (slots.length === 0) return null;

  const byId = new Map(slots.map((slot) => [slot.props.id, slot]));
  const titleOf = (id) => byId.get(id).props.title;
  const save = (next) => setPref("layouts", { ...prefs.layouts, [layoutKey]: next });
  const reset = () => {
    const others = { ...prefs.layouts };
    delete others[layoutKey];
    setPref("layouts", others);
  };
  const move = (id, step) => {
    const next = moved(ids, saved, id, step);
    if (next !== saved) save(next);
  };

  return (
    <>
      <div className="arrange-head">
        {arranging && <span className="arrange-hint">{hint}</span>}
        {!arranging && hidden.length > 0 && (
          <span className="arrange-note">
            {t(hidden.length === 1 ? "arrange.hiddenCount_one" : "arrange.hiddenCount_other", { count: hidden.length })}
          </span>
        )}
        {arranging && isArranged(ids, saved) && (
          <button type="button" className="arrange-btn" onClick={reset}>{t("arrange.reset")}</button>
        )}
        {/* One button that reads Customize, then Done: it stays where it is
            and keeps the keyboard focus, so it can never turn into Reset
            under a second press. */}
        <button
          type="button"
          className={arranging ? "arrange-btn arrange-btn-primary" : "arrange-btn"}
          onClick={() => setArranging(!arranging)}
        >
          {t(arranging ? "arrange.done" : "arrange.customize")}
        </button>
      </div>

      <div ref={grid} style={style}>
        {visible.map((id, index) => (arranging ? (
          <div key={id} className="arrange-tile">
            <span className="arrange-title">{titleOf(id)}</span>
            <button
              type="button"
              className="arrange-btn arrange-step"
              disabled={index === 0}
              aria-label={t("arrange.earlier", { name: titleOf(id) })}
              title={t("arrange.earlier", { name: titleOf(id) })}
              onClick={() => move(id, -1)}
            >
              <Arrow turn={stacked ? 90 : 0} />
            </button>
            <button
              type="button"
              className="arrange-btn arrange-step"
              disabled={index === visible.length - 1}
              aria-label={t("arrange.later", { name: titleOf(id) })}
              title={t("arrange.later", { name: titleOf(id) })}
              onClick={() => move(id, 1)}
            >
              <Arrow turn={stacked ? 270 : 180} />
            </button>
            <button
              type="button"
              className="arrange-btn"
              aria-label={t("arrange.hideNamed", { name: titleOf(id) })}
              onClick={() => save(withHidden(saved, id, true))}
            >
              {t("arrange.hide")}
            </button>
          </div>
        ) : byId.get(id)))}
      </div>

      {arranging && hidden.length > 0 && (
        <div className="arrange-hidden">
          <span>{t("arrange.hidden")}</span>
          {hidden.map((id) => (
            <button
              key={id}
              type="button"
              className="arrange-btn"
              aria-label={t("arrange.show", { name: titleOf(id) })}
              onClick={() => save(withHidden(saved, id, false))}
            >
              + {titleOf(id)}
            </button>
          ))}
        </div>
      )}

      {/* On a phone the list of tiles is about a screen long and the Done
          above it has scrolled away by the time the last one is in place. */}
      {arranging && stacked && (
        <div className="arrange-foot">
          <button type="button" className="arrange-btn arrange-btn-primary" onClick={() => setArranging(false)}>
            {t("arrange.done")}
          </button>
        </div>
      )}
    </>
  );
}
