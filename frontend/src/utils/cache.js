import { get, set, del, clear } from "idb-keyval";

/**
 * Entity types that should be cached for offline reads.
 * Each entry is a string matching the API endpoint slug (e.g. "children"
 * from GET /api/children/).
 */
export const CACHEABLE_ENTITY_TYPES = [
  "children",
  "feedings",
  "sleep",
  "changes",
  "tummy-times",
  "temperature",
  "weight",
  "height",
  "pumping",
  "notes",
  "timers",
  "bmi",
  "head-circumference",
  "medications",
  "milestones",
  "tags",
];

/**
 * Entity types explicitly excluded from caching.
 * Gallery and photos are large binary payloads — not suitable for IndexedDB
 * caching in the first milestone.
 */
export const EXCLUDED_ENTITY_TYPES = [
  "gallery",
  "photos",
];

/**
 * Generate a stable cache key from an entity type and optional query params.
 *
 * Keys look like: `babytracker:children` or `babytracker:weight?child_id=3&from=2024-01-01`.
 *
 * @param {string} entityType - The API entity slug (e.g. "children").
 * @param {object} [params={}] - Query parameters to append.
 * @returns {string} A deterministic cache key.
 */
export function getCacheKey(entityType, params = {}) {
  const base = `babytracker:${entityType}`;
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v != null && v !== "")
  );
  const qs = new URLSearchParams(filtered).toString();
  return qs ? `${base}?${qs}` : base;
}

// -- Cache CRUD --

/**
 * Read a value from the IndexedDB-backed cache.
 * @param {string} key - Cache key from getCacheKey().
 * @returns {Promise<any>} The cached value, or undefined if miss.
 */
export async function cacheGet(key) {
  return get(key);
}

/**
 * Write a value into the IndexedDB-backed cache.
 * @param {string} key - Cache key from getCacheKey().
 * @param {any} value - The value to store.
 * @returns {Promise<void>}
 */
export async function cacheSet(key, value) {
  await set(key, value);
}

/**
 * Remove a single entry from the cache.
 * @param {string} key - Cache key to delete.
 * @returns {Promise<void>}
 */
export async function cacheDelete(key) {
  await del(key);
}

/**
 * Clear the entire babytracker cache namespace.
 * Because idb-keyval stores all keys flat, we iterate and delete keys
 * prefixed with `babytracker:`.
 * @returns {Promise<void>}
 */
export async function cacheClear() {
  // idb-keyval does not expose key listing in older versions, but modern
  // builds ship an `keys()` helper. Fall back to clear() if available.
  try {
    const { keys } = await import("idb-keyval");
    const allKeys = await keys();
    const babyKeys = allKeys.filter((k) =>
      typeof k === "string" && k.startsWith("babytracker:")
    );
    if (babyKeys.length > 0) {
      await Promise.all(babyKeys.map((k) => del(k)));
    }
  } catch {
    // Fall back to clearing all idb-keyval stores (safe — this is a dev
    // cache; no other idb-keyval consumers in the app).
    await clear();
  }
}

// -- Endpoint filtering --

/**
 * Check whether an API endpoint slug should be cached.
 * Matches against CACHEABLE_ENTITY_TYPES and excludes EXCLUDED_ENTITY_TYPES.
 *
 * @param {string} endpoint - The endpoint slug (e.g. "children", "weight?child_id=1").
 * @returns {boolean}
 */
export function isCacheable(endpoint) {
  const slug = endpoint.split("?")[0]; // strip query string
  if (EXCLUDED_ENTITY_TYPES.includes(slug)) return false;
  return CACHEABLE_ENTITY_TYPES.includes(slug);
}