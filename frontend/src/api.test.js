import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "./api";

// A request that outright *fails* has always settled fine. The failure this
// suite covers is the one that doesn't: a connection that is accepted and then
// simply never answered, which before the timeout left the promise pending
// forever and the app stuck on its loading spinner.
function abortError() {
  return Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
}

// Stands in for a server that accepts the connection and never responds.
// Only ever settles when the caller's abort signal fires.
function hangingFetch() {
  return vi.fn((_url, options = {}) =>
    new Promise((_resolve, reject) => {
      const { signal } = options;
      if (!signal) return; // no signal => hangs forever, which is the old behaviour
      if (signal.aborted) return reject(abortError());
      signal.addEventListener("abort", () => reject(abortError()));
    }),
  );
}

function jsonFetch(body, { status = 200 } = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

describe("api request timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves normally when the server answers", async () => {
    vi.stubGlobal("fetch", jsonFetch({ demo_mode: false }));

    await expect(api.getConfig()).resolves.toEqual({ demo_mode: false });
  });

  it("clears its timer once a request settles", async () => {
    vi.stubGlobal("fetch", jsonFetch({ results: [] }));

    await api.getChildren();

    // A leaked timeout would keep firing (and, in a real browser, keep an
    // abort controller alive) long after the request is done.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a stalled request instead of hanging forever", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    const pending = api.getChildren();
    // Attach the assertion before advancing so the rejection is never unhandled
    const assertion = expect(pending).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it("applies the timeout to the config request that gates boot", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    const assertion = expect(api.getConfig()).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it("does not hold uploads to the short request timeout", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    let settled = false;
    const upload = api
      .uploadPhotos(1, [new File(["x"], "a.jpg", { type: "image/jpeg" })])
      .catch(() => { settled = true; });

    // A bulk photo upload legitimately runs well past the 15s request budget.
    await vi.advanceTimersByTimeAsync(60000);
    expect(settled).toBe(false);

    // It still has a ceiling, so a dead socket eventually fails rather than
    // hanging for the life of the tab.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await upload;
    expect(settled).toBe(true);
  });

  it("surfaces a non-abort failure unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

    await expect(api.getChildren()).rejects.toThrow("Failed to fetch");
  });
});

// Session handling under Home Assistant ingress.
//
// The add-on runs in an iframe where the browser regularly drops the refresh
// cookie. Persisting only the access token bought an hour before renewal fell
// back on that same cookie, so households were signed out roughly hourly; and
// because any 4xx from /auth/refresh counted as "session gone", a 429 from the
// rate-limit bucket the whole household shared did the same thing instantly.
describe("session persistence and refresh", () => {
  let mod;

  // Fresh module per test: api.js holds the tokens in module scope.
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    mod = await import("./api");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  // Response shapes for the auth endpoints.
  const session = (n) => ({
    access_token: `access-${n}`,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: `refresh-${n}`,
  });

  const statusFetch = (status, body = {}) =>
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }));

  it("persists both tokens when ingress persistence is on", async () => {
    mod.enableTokenPersistence();
    vi.stubGlobal("fetch", statusFetch(200, session(1)));

    await mod.api.login("parent", "pw");

    expect(localStorage.getItem("babytracker_access_token")).toBe("access-1");
    // The whole point: without this the session dies with the access token.
    expect(localStorage.getItem("babytracker_refresh_token")).toBe("refresh-1");
  });

  it("does not persist anything outside ingress", async () => {
    // enableTokenPersistence() is never called — the cookie is the session.
    vi.stubGlobal("fetch", statusFetch(200, { access_token: "a", token_type: "Bearer", expires_in: 3600 }));

    await mod.api.login("parent", "pw");

    expect(localStorage.getItem("babytracker_access_token")).toBeNull();
    expect(localStorage.getItem("babytracker_refresh_token")).toBeNull();
  });

  it("sends the persisted refresh token in the refresh body", async () => {
    localStorage.setItem("babytracker_refresh_token", "stored-refresh");
    mod.enableTokenPersistence();

    const fetchMock = statusFetch(200, session(2));
    vi.stubGlobal("fetch", fetchMock);

    await mod.bootstrapSession(1);

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ refresh_token: "stored-refresh" });
    // ...and the rotated token replaces the old one.
    expect(localStorage.getItem("babytracker_refresh_token")).toBe("refresh-2");
  });

  it("picks up tokens persisted by an earlier page load", async () => {
    localStorage.setItem("babytracker_access_token", "from-last-time");
    mod.enableTokenPersistence();
    expect(mod.getAccessToken()).toBe("from-last-time");
  });

  it("treats 401 on refresh as a dead session", async () => {
    localStorage.setItem("babytracker_refresh_token", "stored-refresh");
    mod.enableTokenPersistence();
    vi.stubGlobal("fetch", statusFetch(401, { error: "no refresh token" }));

    expect(await mod.bootstrapSession(1)).toBe("expired");
  });

  // The regression this whole change exists to prevent.
  it("treats 429 on refresh as transient, not as a dead session", async () => {
    localStorage.setItem("babytracker_access_token", "access-1");
    localStorage.setItem("babytracker_refresh_token", "stored-refresh");
    mod.enableTokenPersistence();
    vi.stubGlobal("fetch", statusFetch(429, { error: "too many requests" }));

    expect(await mod.bootstrapSession(1)).toBe("transient");
    // Crucially the stored session survives, so the next attempt can use it.
    expect(localStorage.getItem("babytracker_refresh_token")).toBe("stored-refresh");
    expect(localStorage.getItem("babytracker_access_token")).toBe("access-1");
  });

  it("does not sign the user out when a rate-limited refresh interrupts a request", async () => {
    localStorage.setItem("babytracker_access_token", "access-1");
    localStorage.setItem("babytracker_refresh_token", "stored-refresh");
    mod.enableTokenPersistence();

    let authRequired = false;
    mod.setOnAuthRequired(() => { authRequired = true; });

    // The data call 401s (expired access token), then the refresh is throttled.
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const status = String(url).includes("/auth/refresh") ? 429 : 401;
      return {
        ok: false,
        status,
        json: async () => ({}),
        text: async () => "",
      };
    }));

    await expect(mod.api.getChildren()).rejects.toThrow(/429/);
    expect(authRequired).toBe(false);
    expect(localStorage.getItem("babytracker_refresh_token")).toBe("stored-refresh");
  });

  it("does sign the user out when the refresh is genuinely rejected", async () => {
    localStorage.setItem("babytracker_access_token", "access-1");
    localStorage.setItem("babytracker_refresh_token", "stored-refresh");
    mod.enableTokenPersistence();

    let authRequired = false;
    mod.setOnAuthRequired(() => { authRequired = true; });

    vi.stubGlobal("fetch", statusFetch(401, {}));

    await expect(mod.api.getChildren()).rejects.toThrow(/Authentication required/);
    expect(authRequired).toBe(true);
    expect(localStorage.getItem("babytracker_access_token")).toBeNull();
    expect(localStorage.getItem("babytracker_refresh_token")).toBeNull();
  });

  it("hands the refresh token to logout so the server can revoke it", async () => {
    localStorage.setItem("babytracker_refresh_token", "stored-refresh");
    mod.enableTokenPersistence();

    const fetchMock = statusFetch(204, {});
    vi.stubGlobal("fetch", fetchMock);

    await mod.api.logout();

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/auth/logout");
    expect(JSON.parse(options.body)).toEqual({ refresh_token: "stored-refresh" });
    expect(localStorage.getItem("babytracker_refresh_token")).toBeNull();
  });
});
