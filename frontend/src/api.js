const API_BASE = "./api";
const CONFIG_PATH = "./api/config";
const AUTH_BASE = "./api/auth";

// Token management
let accessToken = null;
let onAuthRequired = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setOnAuthRequired(callback) {
  onAuthRequired = callback;
}

async function refreshAccessToken() {
  try {
    const response = await fetch(`${AUTH_BASE}/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) return false;
    const data = await response.json();
    accessToken = data.access_token;
    return true;
  } catch {
    return false;
  }
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

  let response = await fetch(url, config);

  // If unauthorized, try to refresh the token
  if (response.status === 401 && accessToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      config.headers["Authorization"] = `Bearer ${accessToken}`;
      response = await fetch(url, config);
    } else {
      accessToken = null;
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

  // Reminders
  getReminders: (params) => request(`reminders/${qs(params)}`),
  createReminder: (data) =>
    request("reminders/", { method: "POST", body: JSON.stringify(data) }),
  updateReminder: (id, data) =>
    request(`reminders/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteReminder: (id) => request(`reminders/${id}/`, { method: "DELETE" }),

  // Delete for existing entities
  deleteFeeding: (id) => request(`feedings/${id}/`, { method: "DELETE" }),
  deleteSleep: (id) => request(`sleep/${id}/`, { method: "DELETE" }),
  deleteChange: (id) => request(`changes/${id}/`, { method: "DELETE" }),
  deleteTummyTime: (id) => request(`tummy-times/${id}/`, { method: "DELETE" }),
  deleteTemperature: (id) => request(`temperature/${id}/`, { method: "DELETE" }),
  deleteWeight: (id) => request(`weight/${id}/`, { method: "DELETE" }),
  deleteHeight: (id) => request(`height/${id}/`, { method: "DELETE" }),
  deletePumping: (id) => request(`pumping/${id}/`, { method: "DELETE" }),
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
    const resp = await fetch(`${API_BASE}/export/csv?child=${childId}&type=${type}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: "include",
    });
    if (!resp.ok) throw new Error("Export failed");
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = resp.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || "babytracker-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  },

  // Photo uploads
  uploadChildPhoto: (childId, file) => {
    const formData = new FormData();
    formData.append("photo", file);
    return fetch(`${API_BASE}/children/${childId}/photo`, {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: "include",
      body: formData,
    }).then((r) => {
      if (!r.ok) return r.json().then((e) => Promise.reject(e));
      return r.json();
    });
  },
  deleteEntryPhoto: (entityType, entityId) =>
    request(`${entityType}/${entityId}/photo`, { method: "DELETE" }),
  uploadEntryPhoto: (entityType, entityId, file) => {
    const formData = new FormData();
    formData.append("photo", file);
    return fetch(`${API_BASE}/${entityType}/${entityId}/photo`, {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: "include",
      body: formData,
    }).then((r) => {
      if (!r.ok) return r.json().then((e) => Promise.reject(e));
      return r.json();
    });
  },
  uploadMilestonePhoto: (milestoneId, file) => {
    const formData = new FormData();
    formData.append("photo", file);
    return fetch(`${API_BASE}/milestones/${milestoneId}/photo`, {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: "include",
      body: formData,
    }).then((r) => {
      if (!r.ok) return r.json().then((e) => Promise.reject(e));
      return r.json();
    });
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
    return fetch(`${API_BASE}/photos/`, {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: "include",
      body: formData,
    }).then((r) => {
      if (!r.ok) return r.json().then((e) => Promise.reject(e));
      return r.json();
    });
  },
  updatePhoto: (id, data) =>
    request(`photos/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteStandalonePhoto: (id) => request(`photos/${id}/`, { method: "DELETE" }),

  // Gallery
  getGallery: (params) => request(`gallery/${qs(params)}`),

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

  // Roles
  getRoles: () => request("roles/"),
  createRole: (data) =>
    request("roles/", { method: "POST", body: JSON.stringify(data) }),
  updateRolePermissions: (id, permissions) =>
    request(`roles/${id}/permissions`, { method: "PUT", body: JSON.stringify({ permissions }) }),
  deleteRole: (id) => request(`roles/${id}/`, { method: "DELETE" }),

  // Config
  getConfig: () => fetch(CONFIG_PATH).then((r) => r.json()),

  // Auth
  getAuthStatus: () => fetch(`${AUTH_BASE}/status`).then((r) => r.json()),
  register: (username, password) =>
    fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    }).then((r) => {
      if (!r.ok) return r.json().then((e) => Promise.reject(e));
      return r.json();
    }),
  login: (username, password) =>
    fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    }).then((r) => {
      if (!r.ok) return r.json().then((e) => Promise.reject(e));
      return r.json();
    }),
  logout: () =>
    fetch(`${AUTH_BASE}/logout`, {
      method: "POST",
      credentials: "include",
    }),
};
