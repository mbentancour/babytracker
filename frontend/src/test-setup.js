// Vitest setup: ensure a working localStorage in the test environment.
// jsdom under Node 26 doesn't reliably expose one (Node's experimental native
// localStorage is inert without --localstorage-file), and app code reads it at
// module/render time (i18n locale detection, preferences, units).
if (typeof globalThis.localStorage === "undefined" || globalThis.localStorage === null) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}
