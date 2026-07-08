/**
 * Offline status store — dual-detection online/offline monitoring.
 *
 * Combines:
 *  1. navigator.onLine   — instant, OS-level network availability flag
 *  2. Fetch-failure log  — tracks recent API call failures so transient
 *     network blips that navigator.onLine misses are still surfaced
 *
 * Exports:
 *  - isOffline()           — synchronous query of the current status
 *  - getOfflineState()     — full status object snapshot
 *  - observe(callback)     — subscribe to status changes (returns unsubscribe)
 *  - markFetchFailed(url)  — record a fetch failure (called by the api layer)
 *  - markFetchSucceeded()  — record a successful fetch to clear the failure streak
 *  - useOfflineStatus()    — React hook (default export)
 *
 * @module utils/offline
 */

// -- Configuration --

/**
 * How many consecutive fetch failures make us consider the app "offline"
 * even when navigator.onLine is true.
 * A single failure might be a transient 502; 3 in a row is more telling.
 */
const FETCH_FAILURE_THRESHOLD = 3;

/**
 * How many consecutive successful fetches to reset the failure streak.
 * Prevents stale failures from keeping the app "offline" forever.
 */
const FETCH_SUCCESS_RESET = 2;

/**
 * Time window (ms) in which consecutive fetch failures are counted.
 * If the same endpoint fails 3 times across more than 60 seconds,
 * they are treated as separate incidents.
 */
const FAILURE_WINDOW_MS = 60_000;

// -- Internal State --

let currentOffline = !navigator.onLine;
const listeners = new Set();

// Ring buffer of recent fetch failure timestamps (per-URL).
// Each entry: { url, timestamp }
const fetchFailures = new Map();

// Count of consecutive successful fetches (used to drain the failure streak).
let successStreak = 0;

// -- Helpers --

/**
 * Check whether navigator.onLine says we're online.
 * (Exposable for testing / SSR fallback.)
 * @returns {boolean}
 */
function getOnlineFlag() {
  return navigator.onLine;
}

/**
 * Count how many distinct endpoints have failed recently.
 * Only counts failures within FAILURE_WINDOW_MS.
 * @returns {number} Number of distinct failing endpoints.
 */
function countRecentFailures() {
  const now = Date.now();
  let count = 0;
  for (const [, entries] of fetchFailures) {
    const recent = entries.filter((e) => now - e.timestamp < FAILURE_WINDOW_MS);
    if (recent.length > 0) {
      count++;
      // Prune old entries
      fetchFailures.set(entries[0].url, recent);
    } else {
      fetchFailures.delete(entries[0].url);
    }
  }
  return count;
}

/**
 * Recompute currentOffline from both signals.
 * Offline when navigator.onLine is false OR when we have enough recent
 * fetch failures to indicate a real outage.
 */
function recomputeStatus() {
  const wasOffline = currentOffline;
  currentOffline = !getOnlineFlag() || countRecentFailures() >= FETCH_FAILURE_THRESHOLD;
  if (currentOffline !== wasOffline) {
    notifyListeners();
  }
}

/**
 * Notify all registered listeners of a status change.
 */
function notifyListeners() {
  const state = getOfflineState();
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      /* ignore listener errors */
    }
  }
}

// -- Public API --

/**
 * Get the current offline status object.
 * @returns {{ offline: boolean; reason: string }}
 */
export function getOfflineState() {
  recomputeStatus();
  if (!currentOffline) {
    return { offline: false, reason: null };
  }
  // Determine reason: is it navigator.onLine or fetch failures?
  if (!getOnlineFlag()) {
    return { offline: true, reason: "navigator.offline" };
  }
  return { offline: true, reason: "fetch-failures" };
}

/**
 * Synchronous check: is the app considered offline?
 * @returns {boolean}
 */
export function isOffline() {
  return getOfflineState().offline;
}

/**
 * Subscribe to offline status changes.
 * Returns an unsubscribe function.
 * The listener receives the current state on each change.
 * @param {(state: { offline: boolean; reason: string | null }) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function observe(callback) {
  listeners.add(callback);
  // Fire immediately with current state
  callback(getOfflineState());
  return () => {
    listeners.delete(callback);
  };
}

/**
 * Record that a fetch to the given URL failed.
 * Should be called by the API layer whenever a request rejects.
 * @param {string} url — The URL that failed.
 */
export function markFetchFailed(url) {
  if (!fetchFailures.has(url)) {
    fetchFailures.set(url, []);
  }
  fetchFailures.get(url).push({ url, timestamp: Date.now() });
  // Prune old entries for this URL
  const entries = fetchFailures.get(url);
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  fetchFailures.set(url, entries.filter((e) => e.timestamp > cutoff));
  successStreak = 0; // reset success streak on failure
  recomputeStatus();
}

/**
 * Record that a fetch succeeded. Increment the success streak.
 * Once the streak reaches FETCH_SUCCESS_RESET, clear all recent failures.
 */
export function markFetchSucceeded() {
  successStreak++;
  if (successStreak >= FETCH_SUCCESS_RESET) {
    // Drain all recent failures — the network is back.
    fetchFailures.clear();
    successStreak = 0;
    recomputeStatus();
  }
}

// -- Browser event listeners --

// Listen for navigator.onLine changes so UI updates instantly when the OS
// network flag changes (Wi-Fi disconnect, airplane mode, etc.).
if (typeof window !== "undefined") {
  window.addEventListener("online",  () => recomputeStatus());
  window.addEventListener("offline", () => recomputeStatus());
}

// -- React Hook --

/**
 * React hook that returns `{ offline, reason }` and causes a re-render
 * on status changes.
 * @returns {{ offline: boolean; reason: string | null }}
 */
let React = null;
try {
  React = require("react");
} catch {
  // Not in a React environment (e.g., unit tests)
}

let lastHookState = { offline: false, reason: null };

export function useOfflineStatus() {
  if (!React) {
    // Return current state if React is not available (SSR, tests, etc.)
    return getOfflineState();
  }

  const { useState, useEffect, useCallback } = React;
  const [state, setState] = useState(getOfflineState);

  useEffect(() => {
    return observe((newState) => {
      setState(newState);
    });
  }, []);

  return state;
}

// -- Default export: the React hook --

export default useOfflineStatus;