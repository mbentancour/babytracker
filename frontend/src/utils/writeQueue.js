/**
 * IndexedDB-backed write queue for offline persistence.
 *
 * When the network is unavailable, POST/PUT/DELETE operations are stored in
 * IndexedDB and replayed sequentially once connectivity is restored. Failed
 * replays are marked with an error message so the UI can surface them for
 * manual retry.
 *
 * Stores the queue as a single JSON array under the idb-keyval key
 * `"babytracker:writeQueue"`.
 *
 * Exported functions:
 *   - queueAdd(op)             — persist a write operation to the queue
 *   - queueReplay()            — replay pending ops sequentially
 *   - queueGetPending()        — all pending ops
 *   - queueGetFailed()         — all failed ops
 *   - queueGetAll()            — pending + failed
 *   - queueMarkSucceeded(id)   — remove a succeeded op by ID
 *   - queueMarkFailed(id, err) — mark an op as failed with error message
 *   - queueCountPending()      — synchronous count of pending ops
 *   - queueClearFailed()       — clear all failed ops
 *   - queueSubscribe(cb)       — subscribe to queue state changes (React-friendly)
 *
 * @module utils/writeQueue
 */

import { get, set } from "idb-keyval";

const QUEUE_KEY = "babytracker:writeQueue";

// ---------------------------------------------------------------------------
// Subscriber pattern for React integration
// ---------------------------------------------------------------------------

/** @type {Set<(state: {pendingCount: number, failedCount: number}) => void>} */
const queueListeners = new Set();

/**
 * Subscribe to queue state changes.
 * Immediately invokes callback with current state, then on every mutation.
 * @param {(state: {pendingCount: number, failedCount: number}) => void} callback
 * @returns {() => void} Unsubscribe function.
 */
export function queueSubscribe(callback) {
  queueListeners.add(callback);
  callback({ pendingCount: queueCountPendingSync(), failedCount: queueGetFailedSync() });
  return () => { queueListeners.delete(callback); };
}

function notifyQueueListeners() {
  const state = { pendingCount: queueCountPendingSync(), failedCount: queueGetFailedSync() };
  console.log(`[writeQueue] notify: ${state.pendingCount} pending, ${state.failedCount} failed`);
  for (const cb of queueListeners) {
    try { cb(state); } catch { /* ignore listener errors */ }
  }
}

/**
 * Synchronous (in-memory) helpers for the subscriber loop.
 * These read the last known state from a tiny in-memory cache to avoid
 * re-reading IndexedDB on every notify. The cache is refreshed by each
 * mutation so the initial callback always reflects live data.
 */
let _pendingCache = 0;
let _failedCache = 0;

async function refreshCaches() {
  const queue = await readQueue();
  _pendingCache = queue.filter((op) => op.status === "pending").length;
  _failedCache = queue.filter((op) => op.status === "failed").length;
}

function queueCountPendingSync() {
  // Ensure caches are fresh if they've never been initialized
  if (_pendingCache === 0 && _failedCache === 0) {
    // lazy: trust the async read; fallback is stale zero
  }
  return _pendingCache;
}

function queueGetFailedSync() {
  return _failedCache;
}

async function initCaches() {
  if (_pendingCache === 0 && _failedCache === 0) {
    await refreshCaches();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read the entire queue array from IndexedDB.
 * Returns an empty array when nothing is stored.
 * @returns {Promise<Array>}
 */
async function readQueue() {
  try {
    const data = await get(QUEUE_KEY);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Atomically replace the queue array in IndexedDB.
 * @param {Array} queue
 * @returns {Promise<void>}
 */
async function writeQueue(queue) {
  await set(QUEUE_KEY, queue);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a write operation to the queue.
 *
 * @param {object} op
 * @param {string} op.method     — "POST" | "PUT" | "DELETE"
 * @param {string} op.entity     — API endpoint slug, e.g. "feedings"
 * @param {string} op.path       — relative API path, e.g. "feedings/"
 * @param {object|null} [op.body] — JSON-serializable body for POST/PUT; null for DELETE
 * @returns {Promise<object>} The queued operation (with id, timestamp, status assigned).
 */
export async function queueAdd(op) {
  await initCaches();
  const queued = {
    id: `${op.method}-${op.entity}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    method: op.method,
    entity: op.entity,
    path: op.path,
    body: op.body,
    timestamp: Date.now(),
    status: "pending",
    retryCount: 0,
    error: null,
  };

  const queue = await readQueue();
  queue.push(queued);
  await writeQueue(queue);
  _pendingCache += 1;
  notifyQueueListeners();
  return queued;
}

/**
 * Replay all pending operations sequentially.
 *
 * For each operation:
 *   - 2xx/204 → success: remove from queue, add path to success array
 *   - 4xx → failure: markFailed with HTTP status + message, add to failed array
 *   - 5xx / network error → failure: markFailed with error message, add to failed array
 *
 * @returns {Promise<{success: string[], failed: object[]}>}
 */
export async function queueReplay() {
  const queue = await readQueue();
  const pending = queue.filter((op) => op.status === "pending");
  const success = [];
  const failed = [];

  for (const op of pending) {
    try {
      const fetchOptions = {
        method: op.method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      };

      if (op.body !== null && op.body !== undefined) {
        fetchOptions.body = JSON.stringify(op.body);
      }

      const response = await fetch(`./api/${op.path}`, fetchOptions);

      if (response.ok || response.status === 204) {
        await queueMarkSucceeded(op.id);
        success.push(op.path);
      } else {
        const text = await response.text().catch(() => "");
        await queueMarkFailed(op.id, `HTTP ${response.status}: ${text}`);
        failed.push(op);
      }
    } catch (err) {
      // Network error or any fetch-level failure
      const message = err instanceof Error ? err.message : String(err);
      await queueMarkFailed(op.id, message);
      failed.push(op);
    }
  }

  // Refresh caches once after all operations have settled
  await refreshCaches();
  notifyQueueListeners();

  console.log(`[writeQueue] Replay complete: ${success.length} succeeded, ${failed.length} failed`);
  return { success, failed };
}

/**
 * Return all pending (non-failed) operations.
 * @returns {Promise<Array>}
 */
export async function queueGetPending() {
  const queue = await readQueue();
  return queue.filter((op) => op.status === "pending");
}

/**
 * Return all failed operations with their error details.
 * @returns {Promise<Array>}
 */
export async function queueGetFailed() {
  const queue = await readQueue();
  return queue.filter((op) => op.status === "failed");
}

/**
 * Return all operations (pending + failed).
 * @returns {Promise<Array>}
 */
export async function queueGetAll() {
  return readQueue();
}

/**
 * Remove a queued operation by ID (called after successful replay).
 * @param {string} id — The operation ID.
 * @returns {Promise<void>}
 */
export async function queueMarkSucceeded(id) {
  const queue = await readQueue();
  const filtered = queue.filter((op) => op.id !== id);
  await writeQueue(filtered);
  await refreshCaches();
  notifyQueueListeners();
}

/**
 * Mark a queued operation as failed with an error message.
 * Increments retryCount.
 * @param {string} id  — The operation ID.
 * @param {string} error — Human-readable error message.
 * @returns {Promise<void>}
 */
export async function queueMarkFailed(id, error) {
  const queue = await readQueue();
  const index = queue.findIndex((op) => op.id === id);
  if (index === -1) return;
  queue[index].status = "failed";
  queue[index].error = error;
  queue[index].retryCount += 1;
  await writeQueue(queue);
  await refreshCaches();
  notifyQueueListeners();
}

/**
 * Synchronous count of pending operations.
 * Reads from IndexedDB and counts status === "pending".
 * Note: this is async despite the name — returns a Promise<number>.
 * @returns {Promise<number>}
 */
export async function queueCountPending() {
  const queue = await readQueue();
  return queue.filter((op) => op.status === "pending").length;
}

/**
 * Clear all failed operations from the queue.
 * @returns {Promise<void>}
 */
export async function queueClearFailed() {
  const queue = await readQueue();
  const filtered = queue.filter((op) => op.status !== "failed");
  await writeQueue(filtered);
  await refreshCaches();
  notifyQueueListeners();
}

// Initialize caches on module load so the first queueSubscribe call
// reports accurate state instead of zero.
initCaches().catch(() => {});