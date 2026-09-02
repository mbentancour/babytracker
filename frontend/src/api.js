const API_BASE = "./api";
const CONFIG_PATH = "./api/config";
const AUTH_BASE = "./api/auth";

// Token management
//
// In HA add-on (iframe) contexts, cookies are unreliable, so both tokens are
// persisted to localStorage as a workaround. Outside HA, we use in-memory only
// — the refresh cookie is the canonical session, and we avoid the small XSS
// risk of localStorage tokens.
//
// Persisting the *refresh* token matters as much as the access token. Storing
// only the access token bought an hour: after it expired, renewal fell back on
// the very cookie the persistence was working around, so ingress users were
// signed out roughly hourly. The server only returns a refresh token in the
// body when it is itself running under ingress (see issueTokens in auth.go).
//
// Persistence is opt-in via enableTokenPersistence(), called by App.jsx once
// the /api/config response arrives with ha_ingress=true.
const TOKEN_KEY = "babytracker_access_token";
const REFRESH_KEY = "babytracker_refresh_token";
let persistTokens = false;
let accessToken = null;
let refreshToken = null;
let onAuthRequired = null;

export function enableTokenPersistence() {
  persistTokens = true;
  // Pick up existing persisted tokens (e.g. from a previous page load)
  try {
    if (!accessToken) accessToken = localStorage.getItem(TOKEN_KEY) || null;
    if (!refreshToken) refreshToken = localStorage.getItem(REFRESH_KEY) || null;
  } catch { /* localStorage may be disabled */ }
}

function persist(key, value) {
  if (!persistTokens) return;
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* localStorage may be disabled */ }
}

export function setAccessToken(token) {
  accessToken = token;
  persist(TOKEN_KEY, token);
}

// Kept in step with the access token by storeSession(); exported for the
// sign-out path, which has to clear both.
export function setRefreshToken(token) {
  refreshToken = token;
  persist(REFRESH_KEY, token);
}

// storeSession takes an /auth/{login,register,refresh} response and keeps
// whichever tokens it carries. `refresh_token` is absent outside ingress.
function storeSession(data) {
  if (!data) return data;
  if (data.access_token) setAccessToken(data.access_token);
  if (data.refresh_token) setRefreshToken(data.refresh_token);
  return data;
}

export function getAccessToken() {
  return accessToken;
}

export function setOnAuthRequired(callback) {
  onAuthRequired = callback;
}

// refreshPromise coalesces concurrent refresh attempts. Without it, N parallel
// 401s on page load fire N /auth/refresh requests in parallel; the server
// rotates the refresh-token cookie on the first success and the others arrive
// with a deleted hash, all fail, N-1 requests throw "Authentication required".
// Coalescing turns those N /refresh calls into 1 — every caller awaits the
// same promise.
let refreshPromise = null;

function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// doRefresh distinguishes three outcomes:
//   - "ok": refresh succeeded, accessToken updated
//   - "expired": server rejected the refresh cookie (4xx) — the session is
//     genuinely gone and the caller should log out
//   - throws: transient failure (fetch error, 5xx) — the session may still
//     be valid; the caller should surface the error without logging out
//
// Conflating "transient" with "expired" is what caused random logouts: a Wi-Fi
// blip or proxy hiccup during the refresh would kick the user to the login
// screen even though their refresh cookie was still good, and a page reload
// later would succeed.
// Request timeouts
//
// Every fetch in this file used to run without one. A request that *fails*
// settles fine, but a request that merely stalls — a backgrounded mobile tab, a
// flaky link, an ingress proxy that drops the response without closing the
// socket — never settles at all. The boot path awaits getConfig() and the first
// data load before clearing the loading state, so one stalled request left the
// app on "Loading..." indefinitely with no way out but a manual reload.
//
// A timeout converts that into an ordinary rejection, which flows into the
// error handling that already exists: the header's connection-error banner and
// the null-safe empty states.
const DEFAULT_TIMEOUT_MS = 15000;

// Uploads, downloads and restores move real payloads over real links, and a
// bulk photo upload or a backup restore legitimately runs for minutes. They
// still get a ceiling — a dead socket should eventually fail rather than hang
// for the life of the tab — just a far more generous one.
const TRANSFER_TIMEOUT_MS = 10 * 60 * 1000;

// withTimeout runs `work` with an abort signal that fires after `timeoutMs`.
// The budget deliberately covers the *whole* operation rather than just the
// fetch call: reading the body is where a proxy that sends headers and then
// stalls would otherwise slip through, and for a download the body read is the
// entire transfer. `url` is only used to make the error message legible.
async function withTimeout(timeoutMs, url, work) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } catch (err) {
    // The only thing aborting this signal is our own timer, so an AbortError
    // here is always a timeout and never a caller cancelling deliberately.
    if (err?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Shared shape for the multipart upload endpoints: same auth, same cookie
// handling, same tolerant response parsing, same generous transfer budget.
function uploadRequest(url, formData, { auth = true } = {}) {
  return withTimeout(TRANSFER_TIMEOUT_MS, url, (signal) =>
    fetch(url, {
      method: "POST",
      headers: auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: "include",
      body: formData,
      signal,
    }).then(handleUploadResponse),
  );
}

// jsonRequest is the unauthenticated counterpart to request() — used by the
// config and auth endpoints, which run before (or instead of) a session.
function jsonRequest(url, options = {}) {
  return withTimeout(DEFAULT_TIMEOUT_MS, url, (signal) =>
    fetch(url, { ...options, signal }).then((r) => r.json()),
  );
}

async function doRefresh() {
  // Its own budget rather than the caller's: refreshes are coalesced across
  // concurrent callers, so one caller's timeout must not abort the shared
  // refresh out from under the others.
  const response = await withTimeout(DEFAULT_TIMEOUT_MS, `${AUTH_BASE}/refresh`, (signal) =>
    fetch(`${AUTH_BASE}/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      // Empty outside ingress, where the cookie is the session and the server
      // ignores the body anyway.
      body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
      signal,
    }),
  );

  // Only 401 means the session is genuinely gone. This used to be `< 500`,
  // which swept in 429 — so a rate-limited refresh wiped the stored tokens and
  // bounced the user to the login screen, exactly when the household was
  // already contending for one shared bucket.
  if (response.status === 401) return "expired";
  if (!response.ok) throw new Error(`refresh failed: HTTP ${response.status}`);

  storeSession(await response.json());
  return "ok";
}

// bootstrapSession re-establishes a session at startup from whatever is
// persisted. Returns "ok", "expired" (log in again) or "transient" (something
// is wrong that isn't the session).
//
// Retries only transient failures — a network blip on first paint shouldn't
// strand someone at a login screen when their session is fine.
export async function bootstrapSession(attempts = 2) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await refreshAccessToken();
    } catch {
      if (i < attempts - 1) await new Promise((res) => setTimeout(res, 800));
    }
  }
  return "transient";
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE}/${endpoint}`;
  const headers = { "Content-Type": "application/json" };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const config = {
    headers,
    credentials: "include",
    ...options,
  };

  // One budget for the whole logical operation — the initial call, the 401
  // refresh and retry below, and the body read at the end. Giving each leg its
  // own window would let them stack into a 45s hang, which is exactly the
  // failure mode this is here to prevent.
  return withTimeout(DEFAULT_TIMEOUT_MS, url, async (signal) => {
    if (!config.signal) config.signal = signal;

    let response = await fetch(url, config);

    // If unauthorized, try to refresh the token (whether or not we had one).
    // The refresh cookie may still be valid even if the access token is gone.
    // A *transient* refresh failure (network, 5xx) propagates as-is — only an
    // explicit "expired" answer from the server kicks the user to login.
    if (response.status === 401) {
      const result = await refreshAccessToken();
      if (result === "ok") {
        config.headers["Authorization"] = `Bearer ${accessToken}`;
        response = await fetch(url, config);
      } else {
        setAccessToken(null);
        setRefreshToken(null);
        if (onAuthRequired) onAuthRequired();
        throw new Error("Authentication required");
      }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`API error ${response.status}: ${text}`);
    }

    if (response.status === 204) return null;
    return response.json();
  });
}

// handleUploadResponse is the error-tolerant response parser used by the
// multipart-upload helpers below. Upload errors can come back as plain text
// (e.g. the Home Assistant ingress proxy returning a 413 before the Go
// handler runs, or http.MaxBytesReader tripping) and calling .json() on a
// non-JSON body throws Safari's "The string did not match the expected
// pattern." — which is worse than useless when shown to users.
async function handleUploadResponse(r) {
  const text = await r.text().catch(() => "");
  if (r.ok) {
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  }
  let payload;
  try { payload = JSON.parse(text); }
  catch { payload = { error: text || `HTTP ${r.status}` }; }
  throw payload;
}

function qs(params) {
  if (!params) return "";
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v != null && v !== "")
  );
  const s = new URLSearchParams(filtered).toString();
  return s ? `?${s}` : "";
}

export const api = {
  // Children
  getChildren: () => request("children/"),
  createChild: (data) =>
    request("children/", { method: "POST", body: JSON.stringify(data) }),
  updateChild: (id, data) =>
    request(`children/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Feedings
  getFeedings: (params) => request(`feedings/${qs(params)}`),
  createFeeding: (data) =>
    request("feedings/", { method: "POST", body: JSON.stringify(data) }),
  updateFeeding: (id, data) =>
    request(`feedings/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Sleep
  getSleep: (params) => request(`sleep/${qs(params)}`),
  createSleep: (data) =>
    request("sleep/", { method: "POST", body: JSON.stringify(data) }),
  updateSleep: (id, data) =>
    request(`sleep/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Diapers (changes)
  getChanges: (params) => request(`changes/${qs(params)}`),
  createChange: (data) =>
    request("changes/", { method: "POST", body: JSON.stringify(data) }),
  updateChange: (id, data) =>
    request(`changes/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Tummy time
  getTummyTimes: (params) => request(`tummy-times/${qs(params)}`),
  createTummyTime: (data) =>
    request("tummy-times/", { method: "POST", body: JSON.stringify(data) }),
  updateTummyTime: (id, data) =>
    request(`tummy-times/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Temperature
  getTemperature: (params) => request(`temperature/${qs(params)}`),
  createTemperature: (data) =>
    request("temperature/", { method: "POST", body: JSON.stringify(data) }),
  updateTemperature: (id, data) =>
    request(`temperature/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Weight
  getWeight: (params) => request(`weight/${qs(params)}`),
  createWeight: (data) =>
    request("weight/", { method: "POST", body: JSON.stringify(data) }),
  updateWeight: (id, data) =>
    request(`weight/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Height
  getHeight: (params) => request(`height/${qs(params)}`),
  createHeight: (data) =>
    request("height/", { method: "POST", body: JSON.stringify(data) }),
  updateHeight: (id, data) =>
    request(`height/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Pumping
  getPumping: (params) => request(`pumping/${qs(params)}`),
  createPumping: (data) =>
    request("pumping/", { method: "POST", body: JSON.stringify(data) }),
  updatePumping: (id, data) =>
    request(`pumping/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Uneaten milk, and the stash balance derived from it. getMilkStock is a
  // server-side aggregate over all time — the running total can't be computed
  // from the 7/30-day windows the rest of the app fetches.
  getMilkWaste: (params) => request(`milk-waste/${qs(params)}`),
  createMilkWaste: (data) =>
    request("milk-waste/", { method: "POST", body: JSON.stringify(data) }),
  updateMilkWaste: (id, data) =>
    request(`milk-waste/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  getMilkStock: (childId) => request(`milk-stock${qs({ child: childId })}`),

  // Notes
  getNotes: (params) => request(`notes/${qs(params)}`),
  createNote: (data) =>
    request("notes/", { method: "POST", body: JSON.stringify(data) }),
  updateNote: (id, data) =>
    request(`notes/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),

  // Timers
  getTimers: () => request("timers/"),
  createTimer: (data) =>
    request("timers/", { method: "POST", body: JSON.stringify(data) }),
  updateTimer: (id, data) =>
    request(`timers/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  pauseTimer: (id) =>
    request(`timers/${id}/pause/`, { method: "POST" }),
  resumeTimer: (id) =>
    request(`timers/${id}/resume/`, { method: "POST" }),
  deleteTimer: (id) => request(`timers/${id}/`, { method: "DELETE" }),

  // BMI
  getBMI: (params) => request(`bmi/${qs(params)}`),
  createBMI: (data) =>
    request("bmi/", { method: "POST", body: JSON.stringify(data) }),
  updateBMI: (id, data) =>
    request(`bmi/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteBMI: (id) => request(`bmi/${id}/`, { method: "DELETE" }),

  // Head circumference
  getHeadCircumference: (params) => request(`head-circumference/${qs(params)}`),
  createHeadCircumference: (data) =>
    request("head-circumference/", { method: "POST", body: JSON.stringify(data) }),
  updateHeadCircumference: (id, data) =>
    request(`head-circumference/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteHeadCircumference: (id) => request(`head-circumference/${id}/`, { method: "DELETE" }),

  // Tags
  getTags: () => request("tags/"),
  createTag: (data) =>
    request("tags/", { method: "POST", body: JSON.stringify(data) }),
  updateTag: (id, data) =>
    request(`tags/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTag: (id) => request(`tags/${id}/`, { method: "DELETE" }),
  getEntityTags: (entityType, entityId) => request(`tags/${entityType}/${entityId}/`),
  setEntityTags: (entityType, entityId, tagIds) =>
    request(`tags/${entityType}/${entityId}/`, { method: "PUT", body: JSON.stringify({ tag_ids: tagIds }) }),
  // Bulk lookup used by list views: returns { "<entity_id>": [tag...] } for
  // every entity of this type that has at least one tag. Empty keys (no tags)
  // are omitted.
  getEntityTagsBulk: (entityType) => request(`tags/bulk?entity_type=${encodeURIComponent(entityType)}`),

  // Medications
  getMedications: (params) => request(`medications/${qs(params)}`),
  createMedication: (data) =>
    request("medications/", { method: "POST", body: JSON.stringify(data) }),
  updateMedication: (id, data) =>
    request(`medications/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteMedication: (id) => request(`medications/${id}/`, { method: "DELETE" }),

  // Milestones
  getMilestones: (params) => request(`milestones/${qs(params)}`),
  createMilestone: (data) =>
    request("milestones/", { method: "POST", body: JSON.stringify(data) }),
  updateMilestone: (id, data) =>
    request(`milestones/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteMilestone: (id) => request(`milestones/${id}/`, { method: "DELETE" }),

  // Delete for existing entities
  deleteFeeding: (id) => request(`feedings/${id}/`, { method: "DELETE" }),
  deleteSleep: (id) => request(`sleep/${id}/`, { method: "DELETE" }),
  deleteChange: (id) => request(`changes/${id}/`, { method: "DELETE" }),
  deleteTummyTime: (id) => request(`tummy-times/${id}/`, { method: "DELETE" }),
  deleteTemperature: (id) => request(`temperature/${id}/`, { method: "DELETE" }),
  deleteWeight: (id) => request(`weight/${id}/`, { method: "DELETE" }),
  deleteHeight: (id) => request(`height/${id}/`, { method: "DELETE" }),
  deletePumping: (id) => request(`pumping/${id}/`, { method: "DELETE" }),
  deleteMilkWaste: (id) => request(`milk-waste/${id}/`, { method: "DELETE" }),
  deleteNote: (id) => request(`notes/${id}/`, { method: "DELETE" }),
  deleteChild: (id) => request(`children/${id}/`, { method: "DELETE" }),

  // API Tokens
  getAPITokens: () => request("tokens/"),
  createAPIToken: (data) =>
    request("tokens/", { method: "POST", body: JSON.stringify(data) }),
  deleteAPIToken: (id) => request(`tokens/${id}/`, { method: "DELETE" }),

  // Webhooks
  getWebhooks: () => request("webhooks/"),
  createWebhook: (data) =>
    request("webhooks/", { method: "POST", body: JSON.stringify(data) }),
  updateWebhook: (id, data) =>
    request(`webhooks/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteWebhook: (id) => request(`webhooks/${id}/`, { method: "DELETE" }),

  // Data export - fetches with auth and triggers download
  exportCSV: async (childId, type = "all") => {
    const endpoint = `${API_BASE}/export/csv?child=${childId}&type=${type}`;
    const { blob, filename } = await withTimeout(TRANSFER_TIMEOUT_MS, endpoint, async (signal) => {
      const resp = await fetch(endpoint, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: "include",
        signal,
      });
      if (!resp.ok) {
        // Prefer the server's {error} body; fall back to the HTTP status
        // (statusText is empty over HTTP/2). The caller adds the
        // "Export failed:" prefix, so don't repeat it here.
        let message = resp.statusText || `HTTP ${resp.status}`;
        try {
          const body = await resp.json();
          if (body?.error) message = body.error;
        } catch {
          // not a JSON body
        }
        throw new Error(message);
      }
      const blob = await resp.blob();
      const filename = resp.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || "babytracker-export.csv";
      return { blob, filename };
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  // Photo uploads
  uploadChildPhoto: (childId, file) => {
    const formData = new FormData();
    formData.append("photo", file);
    return uploadRequest(`${API_BASE}/children/${childId}/photo`, formData);
  },
  setChildPhotoFromFilename: (childId, filename) =>
    request(`children/${childId}/photo`, { method: "PUT", body: JSON.stringify({ filename }) }),
  deleteEntryPhoto: (entityType, entityId) =>
    request(`${entityType}/${entityId}/photo`, { method: "DELETE" }),
  uploadEntryPhoto: (entityType, entityId, file) => {
    const formData = new FormData();
    formData.append("photo", file);
    return uploadRequest(`${API_BASE}/${entityType}/${entityId}/photo`, formData);
  },
  uploadMilestonePhoto: (milestoneId, file) => {
    const formData = new FormData();
    formData.append("photo", file);
    return uploadRequest(`${API_BASE}/milestones/${milestoneId}/photo`, formData);
  },

  // Standalone photos
  getPhotos: (params) => request(`photos/${qs(params)}`),
  uploadPhotos: (childId, files, caption) => {
    const formData = new FormData();
    formData.append("child", String(childId));
    if (caption) formData.append("caption", caption);
    for (const file of files) {
      formData.append("photos", file);
    }
    return uploadRequest(`${API_BASE}/photos/`, formData);
  },
  updatePhoto: (id, data) =>
    request(`photos/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteStandalonePhoto: (id) => request(`photos/${id}/`, { method: "DELETE" }),

  // Gallery
  getGallery: (params) => request(`gallery/${qs(params)}`),
  tagPhoto: (filename, childIds) =>
    request("gallery/tag", { method: "POST", body: JSON.stringify({ filename, child_ids: childIds }) }),

  // Baby Buddy import (admin)
  importFromBabyBuddy: (url, token) =>
    request("import/babybuddy", { method: "POST", body: JSON.stringify({ url, token }) }),

  // Backups (admin)
  getBackups: () => request("backups/"),
  createBackup: (destinationIds, passphrases) =>
    request("backups/", {
      method: "POST",
      body: JSON.stringify({ destination_ids: destinationIds || [], passphrases: passphrases || {} }),
    }),
  downloadBackup: async (name, destinationId) => {
    const params = new URLSearchParams({ name });
    if (destinationId != null) params.set("destination_id", String(destinationId));
    const endpoint = `${API_BASE}/backups/download?${params.toString()}`;
    const blob = await withTimeout(TRANSFER_TIMEOUT_MS, endpoint, async (signal) => {
      const resp = await fetch(endpoint, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        credentials: "include",
        signal,
      });
      if (!resp.ok) throw new Error("Download failed");
      return resp.blob();
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },
  deleteBackup: (name, destinationId) => {
    const params = new URLSearchParams({ name });
    if (destinationId != null) params.set("destination_id", String(destinationId));
    return request(`backups/?${params.toString()}`, { method: "DELETE" });
  },
  restoreBackup: (file, passphrase, wipePhotos) => {
    const formData = new FormData();
    formData.append("backup", file);
    if (passphrase) formData.append("passphrase", passphrase);
    if (wipePhotos) formData.append("wipe_photos", "true");
    return uploadRequest(`${API_BASE}/backups/restore`, formData);
  },
  restoreBackupFromDestination: (destinationId, name, passphrase, wipePhotos) => {
    const formData = new FormData();
    formData.append("destination_id", String(destinationId));
    formData.append("name", name);
    if (passphrase) formData.append("passphrase", passphrase);
    if (wipePhotos) formData.append("wipe_photos", "true");
    return uploadRequest(`${API_BASE}/backups/restore`, formData);
  },

  // Backup destinations (admin)
  listBackupDestinations: () => request("backups/destinations"),
  createBackupDestination: (payload) =>
    request("backups/destinations", { method: "POST", body: JSON.stringify(payload) }),
  updateBackupDestination: (id, payload) =>
    request(`backups/destinations/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteBackupDestination: (id) =>
    request(`backups/destinations/${id}`, { method: "DELETE" }),
  testBackupDestination: (id) =>
    request(`backups/destinations/${id}/test`, { method: "POST" }),
  inspectDestinationCert: (url) =>
    request("backups/destinations/inspect-cert", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  // Domain/TLS settings (admin)
  getDomain: () => request("settings/domain"),
  setDomain: (domain) =>
    request("settings/domain", { method: "PUT", body: JSON.stringify({ domain }) }),

  // TLS/ACME settings (admin)
  getTLS: () => request("settings/tls"),
  setTLS: (config) =>
    request("settings/tls", { method: "PUT", body: JSON.stringify(config) }),
  testTLS: (config) =>
    request("settings/tls/test", { method: "POST", body: JSON.stringify(config) }),

  // System controls (admin)
  restartSystem: () => request("system/restart", { method: "POST" }),
  shutdownSystem: () => request("system/shutdown", { method: "POST" }),
  getStorage: () => request("system/storage"),

  // Display control (admin)
  getDisplays: () => request("display"),
  setDisplay: ({ picture_frame, device }) =>
    request("display", {
      method: "PUT",
      body: JSON.stringify({ picture_frame, device }),
    }),

  // Version + self-update (admin)
  getVersion: () => request("system/version"),
  checkUpdate: () => request("system/update/check"),
  applyUpdate: (tag) =>
    request("system/update/apply", {
      method: "POST",
      body: JSON.stringify(tag ? { tag } : {}),
    }),

  // User management (admin)
  getUsers: () => request("users/"),
  createUser: (data) =>
    request("users/", { method: "POST", body: JSON.stringify(data) }),
  deleteUser: (id) => request(`users/${id}/`, { method: "DELETE" }),
  grantAccess: (userId, childId, roleId) =>
    request(`users/${userId}/access`, { method: "POST", body: JSON.stringify({ child_id: childId, role_id: roleId }) }),
  revokeAccess: (userId, childId) =>
    request(`users/${userId}/access/${childId}`, { method: "DELETE" }),
  getCurrentUserAccess: () => request("users/me"),
  changePassword: (currentPassword, newPassword) =>
    request("users/me/password", { method: "PUT", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }),
  resetUserPassword: (userId, newPassword) =>
    request(`users/${userId}/password`, { method: "PUT", body: JSON.stringify({ new_password: newPassword }) }),

  // Roles
  getRoles: () => request("roles/"),
  createRole: (data) =>
    request("roles/", { method: "POST", body: JSON.stringify(data) }),
  updateRolePermissions: (id, permissions) =>
    request(`roles/${id}/permissions`, { method: "PUT", body: JSON.stringify({ permissions }) }),
  deleteRole: (id) => request(`roles/${id}/`, { method: "DELETE" }),

  // Config
  //
  // This one gates the whole boot sequence, so its timeout is what stops a
  // stalled config request from pinning the app on the loading spinner.
  getConfig: () => jsonRequest(CONFIG_PATH),

  // Auth
  getAuthStatus: () => jsonRequest(`${AUTH_BASE}/status`),
  setupRestore: (file, passphrase, wipePhotos) => {
    const formData = new FormData();
    formData.append("backup", file);
    if (passphrase) formData.append("passphrase", passphrase);
    if (wipePhotos) formData.append("wipe_photos", "true");
    // No auth header: this runs during first-boot setup, before any session.
    return uploadRequest(`${AUTH_BASE}/setup-restore`, formData, { auth: false });
  },
  register: (username, password) =>
    withTimeout(DEFAULT_TIMEOUT_MS, `${AUTH_BASE}/register`, (signal) =>
      fetch(`${AUTH_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
        signal,
      }).then(async (r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e));
        return storeSession(await r.json());
      }),
    ),
  login: (username, password) =>
    withTimeout(DEFAULT_TIMEOUT_MS, `${AUTH_BASE}/login`, (signal) =>
      fetch(`${AUTH_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
        signal,
      }).then(async (r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e));
        return storeSession(await r.json());
      }),
    ),
  // Sends the stored refresh token so the server can revoke that session even
  // when the cookie never made it into the ingress iframe — otherwise signing
  // out would leave a working 30-day token behind on the server.
  logout: () => {
    const presented = refreshToken;
    setRefreshToken(null);
    return withTimeout(DEFAULT_TIMEOUT_MS, `${AUTH_BASE}/logout`, (signal) =>
      fetch(`${AUTH_BASE}/logout`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(presented ? { refresh_token: presented } : {}),
        signal,
      }),
    );
  },
};
