// What the user just did, held on top of what the server last told us.
//
// A full refresh is two dozen requests; on a small home server that is a
// second or more. Waiting for it before showing a feed you just logged makes
// the app feel like it didn't hear you. So a logged entry is shown at once
// from the server's own reply, a deleted one disappears at once, and a moved
// one moves at once — and each of those steps aside as soon as a refresh
// shows the same thing.
//
// An overlay is { added: { list: [entry] }, removed: [key], patched: { key: entry } }
// where key is "list:id". All functions are pure and return a new overlay
// only when something changed, so they are safe to run after every refresh.

export const EMPTY_OVERLAY = { added: {}, removed: [], patched: {} };

const keyOf = (list, id) => `${list}:${id}`;
const sameMoment = (a, b) => new Date(a).getTime() === new Date(b).getTime();

// The fields a change made here can touch, and how to tell that the server's
// copy now says the same: times as instants (the two sides write them
// differently), the rest by value.
const WATCHED = {
  start: sameMoment,
  end: sameMoment,
  time: sameMoment,
  amount: (a, b) => Number(a) === Number(b),
  is_paused: (a, b) => !!a === !!b,
};

export function withAdded(overlay, list, entry) {
  return { ...overlay, added: { ...overlay.added, [list]: [...(overlay.added[list] || []), entry] } };
}

export function withRemoved(overlay, list, id) {
  const key = keyOf(list, id);
  return overlay.removed.includes(key) ? overlay : { ...overlay, removed: [...overlay.removed, key] };
}

export function withoutRemoved(overlay, list, id) {
  const key = keyOf(list, id);
  return overlay.removed.includes(key) ? { ...overlay, removed: overlay.removed.filter((k) => k !== key) } : overlay;
}

// withoutAdded forgets an entry that was only ever known from here — one
// deleted (or a timer finished) before any refresh had listed it, which no
// later refresh will ever list.
export function withoutAdded(overlay, list, id) {
  const entries = overlay.added[list];
  if (!entries || !entries.some((e) => e.id === id)) return overlay;
  const added = { ...overlay.added, [list]: entries.filter((e) => e.id !== id) };
  if (!added[list].length) delete added[list];
  return { ...overlay, added };
}

export function withPatched(overlay, list, entry) {
  const mine = overlay.added[list];
  // An entry the server hasn't listed yet lives in `added`; change it there,
  // or the change would be dropped as "nothing to compare against".
  const added = mine?.some((e) => e.id === entry.id)
    ? { ...overlay.added, [list]: mine.map((e) => (e.id === entry.id ? entry : e)) }
    : overlay.added;
  return { ...overlay, added, patched: { ...overlay.patched, [keyOf(list, entry.id)]: entry } };
}

export function withoutPatched(overlay, list, id) {
  const key = keyOf(list, id);
  if (!(key in overlay.patched)) return overlay;
  const patched = { ...overlay.patched };
  delete patched[key];
  return { ...overlay, patched };
}

// applyOverlay returns the lists as the user should see them right now.
export function applyOverlay(lists, overlay) {
  if (overlay === EMPTY_OVERLAY) return lists;
  const names = new Set([...Object.keys(lists), ...Object.keys(overlay.added)]);
  const out = {};
  for (const name of names) {
    const server = lists[name] || [];
    const seen = new Set(server.map((e) => e.id));
    const extra = (overlay.added[name] || []).filter((e) => !seen.has(e.id));
    out[name] = [...server, ...extra]
      .filter((e) => !overlay.removed.includes(keyOf(name, e.id)))
      .map((e) => overlay.patched[keyOf(name, e.id)] || e);
  }
  return out;
}

// pruneOverlay drops everything the server's lists now show for themselves:
// an added entry that has arrived, a removed one that is gone, a changed one
// the server now agrees with.
export function pruneOverlay(lists, overlay) {
  if (overlay === EMPTY_OVERLAY) return overlay;
  let changed = false;
  const has = (name, id) => (lists[name] || []).some((e) => String(e.id) === String(id));

  const added = {};
  for (const [name, entries] of Object.entries(overlay.added)) {
    const kept = entries.filter((e) => !has(name, e.id));
    if (kept.length !== entries.length) changed = true;
    if (kept.length) added[name] = kept;
  }

  const removed = overlay.removed.filter((key) => {
    const [name, id] = key.split(":");
    return has(name, id);
  });
  if (removed.length !== overlay.removed.length) changed = true;

  const patched = {};
  for (const [key, entry] of Object.entries(overlay.patched)) {
    const [name, id] = key.split(":");
    const server = (lists[name] || []).find((e) => String(e.id) === String(id));
    const caughtUp = !server || Object.entries(WATCHED).every(([f, same]) => entry[f] == null || same(entry[f], server[f]));
    if (caughtUp) changed = true;
    else patched[key] = entry;
  }

  if (!changed) return overlay;
  if (!Object.keys(added).length && !removed.length && !Object.keys(patched).length) return EMPTY_OVERLAY;
  return { added, removed, patched };
}
