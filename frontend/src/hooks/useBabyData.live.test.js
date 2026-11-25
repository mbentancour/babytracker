import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listenForChanges } from "./useBabyData";

const CONNECTED = 'data: {"connected":true}\n\n';
const CHANGED = 'data: {"changed":true}\n\n';
const KEEP_ALIVE = ": keep-alive\n\n";

// The body of a stream the test speaks through: say() sends a chunk, end()
// closes it as the server would, fail() breaks it as a lost connection would.
function fakeStream() {
  const chunks = [];
  let waiting = null;
  let over = null;
  const settle = () => {
    if (!waiting) return;
    const { resolve, reject } = waiting;
    if (chunks.length) {
      waiting = null;
      resolve({ done: false, value: chunks.shift() });
    } else if (over) {
      waiting = null;
      if (over.error) reject(over.error);
      else resolve({ done: true, value: undefined });
    }
  };
  return {
    reader: {
      read: () => new Promise((resolve, reject) => {
        waiting = { resolve, reject };
        settle();
      }),
    },
    say: (text) => {
      chunks.push(new TextEncoder().encode(text));
      settle();
    },
    end: () => {
      over = {};
      settle();
    },
    fail: (error) => {
      over = { error };
      settle();
    },
  };
}

// A stand-in for fetch: every request is kept, and the test decides how each
// is answered. Aborting a request fails it, and its stream, as a browser does.
function fakeServer() {
  const calls = [];
  const fetch = vi.fn((url, init) => new Promise((resolve, reject) => {
    const call = { url, init, stream: null };
    const headers = (type) => ({ get: (name) => (name.toLowerCase() === "content-type" ? type : null) });
    // Answers with a stream and returns it.
    call.open = () => {
      call.stream = fakeStream();
      resolve({ ok: true, status: 200, headers: headers("text/event-stream"), body: { getReader: () => call.stream.reader } });
      return call.stream;
    };
    // Answers with anything else.
    call.answer = (status, type = "application/json") => {
      resolve({ ok: status >= 200 && status < 300, status, headers: headers(type), body: null });
    };
    call.drop = () => reject(new TypeError("Failed to fetch"));
    init.signal.addEventListener("abort", () => {
      const gone = new DOMException("The operation was aborted.", "AbortError");
      reject(gone);
      call.stream?.fail(gone);
    });
    calls.push(call);
  }));
  return { fetch, calls };
}

describe("listenForChanges", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 14, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Lets whatever is waiting on a promise carry on, and runs what is due.
  const settle = () => vi.advanceTimersByTimeAsync(0);
  const pass = (ms) => vi.advanceTimersByTimeAsync(ms);

  const start = ({ lastFetch = 0, token = "access-1", refresh } = {}) => {
    const server = fakeServer();
    const refetch = vi.fn();
    const lastFetchRef = { current: lastFetch };
    const tokens = { current: token };
    const renew = refresh || vi.fn(async () => "ok");
    const stop = listenForChanges(refetch, lastFetchRef, {
      fetch: server.fetch,
      getToken: () => tokens.current,
      refresh: renew,
    });
    return { ...server, refetch, lastFetchRef, tokens, refresh: renew, stop };
  };

  // Starts listening and answers the first request with a stream that has
  // already said it is open.
  const listening = async (options) => {
    const session = start(options);
    const stream = session.calls[0].open();
    stream.say(CONNECTED);
    await settle();
    return { ...session, stream };
  };

  it("asks for the stream the way the app's other requests are sent", () => {
    const { calls } = start();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("./api/events");
    expect(calls[0].init.credentials).toBe("include");
    expect(calls[0].init.headers.Authorization).toBe("Bearer access-1");
  });

  it("sends no token when there is none, and leaves it to the cookie", () => {
    const { calls } = start({ token: null });
    expect("Authorization" in calls[0].init.headers).toBe(false);
    expect(calls[0].init.credentials).toBe("include");
  });

  it("ignores the first message, which only says the stream is open", async () => {
    const { refetch } = await listening();
    await pass(5000);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("refetches shortly after a change elsewhere", async () => {
    const { refetch, stream } = await listening();
    stream.say(CHANGED);
    await settle();
    expect(refetch).not.toHaveBeenCalled();
    await pass(300);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("rolls a burst of changes into one refetch", async () => {
    const { refetch, stream } = await listening();
    for (let i = 0; i < 5; i++) {
      stream.say(CHANGED);
      await pass(100);
    }
    expect(refetch).not.toHaveBeenCalled();
    await pass(300);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("skips the refetch on the screen that just fetched after its own save", async () => {
    const { refetch, stream, lastFetchRef } = await listening();
    lastFetchRef.current = Date.now();
    stream.say(CHANGED);
    await pass(300);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("takes a keep-alive line for what it is", async () => {
    const { refetch, stream } = await listening();
    stream.say(KEEP_ALIVE);
    stream.say(KEEP_ALIVE);
    await pass(5000);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("puts a message together from the pieces it arrives in", async () => {
    const { calls, refetch } = start();
    const stream = calls[0].open();
    stream.say('data: {"conn');
    stream.say('ected":true}\n');
    stream.say('\ndata: {"changed"');
    await pass(1000);
    expect(refetch).not.toHaveBeenCalled();
    stream.say(":true}\n\n");
    await pass(300);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("opens the stream again when it ends, and refetches once it is open", async () => {
    const { calls, refetch, stream } = await listening();
    await pass(60000);
    stream.end();
    await pass(999);
    expect(calls).toHaveLength(1);
    await pass(1);
    expect(calls).toHaveLength(2);
    expect(refetch).not.toHaveBeenCalled();

    // Changes may have been missed in between.
    calls[1].open().say(CONNECTED);
    await pass(300);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("opens the stream again when the connection is lost", async () => {
    const { calls, stream } = await listening();
    await pass(60000);
    stream.fail(new TypeError("network error"));
    await pass(1000);
    expect(calls).toHaveLength(2);
  });

  it("waits longer each time the stream cannot be opened", async () => {
    const { calls } = start();
    let made = 1;
    for (const wait of [1000, 2000, 5000, 10000, 30000, 30000, 30000]) {
      calls[made - 1].drop();
      await pass(wait - 1);
      expect(calls).toHaveLength(made);
      await pass(1);
      made += 1;
      expect(calls).toHaveLength(made);
    }
  });

  it("starts the waits over after a stream that held", async () => {
    const { calls } = start();
    calls[0].drop();
    await pass(1000);
    calls[1].drop();
    await pass(2000);
    expect(calls).toHaveLength(3);

    const stream = calls[2].open();
    stream.say(CONNECTED);
    await pass(10000);
    stream.end();
    await pass(1000);
    expect(calls).toHaveLength(4);
  });

  it("keeps waiting longer when a stream is dropped as soon as it opens", async () => {
    const { calls, refetch } = start();
    const waits = [1000, 2000, 5000, 10000, 30000, 30000];
    for (let i = 0; i < waits.length; i++) {
      const stream = calls[i].open();
      stream.say(CONNECTED);
      await pass(50);
      stream.end();
      await pass(waits[i] - 1);
      expect(calls).toHaveLength(i + 1);
      await pass(1);
      expect(calls).toHaveLength(i + 2);
    }
    // One refetch per reopening and no more: never one a second.
    expect(refetch).toHaveBeenCalledTimes(waits.length - 1);
  });

  it("renews the access token when the server refuses it, and asks again at once", async () => {
    const session = start();
    const { calls, tokens, refetch } = session;
    session.refresh.mockImplementation(async () => {
      tokens.current = "access-2";
      return "ok";
    });
    calls[0].answer(401);
    await settle();
    expect(session.refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].init.headers.Authorization).toBe("Bearer access-2");

    // It is still the first stream this screen has had.
    const stream = calls[1].open();
    stream.say(CONNECTED);
    await pass(1000);
    expect(refetch).not.toHaveBeenCalled();
    stream.say(CHANGED);
    await pass(300);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("gives up when it is refused with a fresh token", async () => {
    const { calls, refresh } = start();
    calls[0].answer(401);
    await settle();
    calls[1].answer(401);
    await pass(10 * 60000);
    expect(calls).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gives up when the session itself is gone", async () => {
    const { calls } = start({ refresh: vi.fn(async () => "expired") });
    calls[0].answer(401);
    await pass(10 * 60000);
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tries again later when the token could not be renewed just now", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("refresh failed: HTTP 502")).mockResolvedValue("ok");
    const { calls } = start({ refresh });
    calls[0].answer(401);
    await pass(999);
    expect(calls).toHaveLength(1);
    await pass(1);
    expect(calls).toHaveLength(2);
  });

  it("tries again when the server is restarting or busy", async () => {
    const { calls } = start();
    calls[0].answer(503, "text/plain");
    await pass(1000);
    expect(calls).toHaveLength(2);
    calls[1].answer(429);
    await pass(2000);
    expect(calls).toHaveLength(3);
  });

  it("gives up on an answer that is not a stream", async () => {
    const missing = start();
    missing.calls[0].answer(404);
    await pass(10 * 60000);
    expect(missing.calls).toHaveLength(1);

    // A proxy answering with a page of its own.
    const page = start();
    page.calls[0].answer(200, "text/html");
    await pass(10 * 60000);
    expect(page.calls).toHaveLength(1);
    expect(page.calls[0].init.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a stream that has gone silent and opens another", async () => {
    const { calls, stream } = await listening();
    // Keep-alive lines every 25 seconds keep it.
    for (let i = 0; i < 6; i++) {
      await pass(25000);
      stream.say(KEEP_ALIVE);
      await settle();
    }
    expect(calls[0].init.signal.aborted).toBe(false);

    await pass(69999);
    expect(calls[0].init.signal.aborted).toBe(false);
    await pass(1);
    expect(calls[0].init.signal.aborted).toBe(true);
    await pass(1000);
    expect(calls).toHaveLength(2);
  });

  it("closes the stream and drops a pending refetch when stopped", async () => {
    const { calls, refetch, stream, stop } = await listening();
    stream.say(CHANGED);
    await settle();
    stop();
    expect(calls[0].init.signal.aborted).toBe(true);
    await pass(10 * 60000);
    expect(refetch).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not open another stream once stopped, whatever it was waiting for", async () => {
    // Waiting to try again.
    const waiting = start();
    waiting.calls[0].drop();
    await pass(500);
    waiting.stop();
    await pass(10 * 60000);
    expect(waiting.calls).toHaveLength(1);

    // Waiting for a new token.
    let renewed;
    const renewing = start({ refresh: vi.fn(() => new Promise((resolve) => { renewed = resolve; })) });
    renewing.calls[0].answer(401);
    await settle();
    renewing.stop();
    renewed("ok");
    await pass(10 * 60000);
    expect(renewing.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does nothing where there is no fetch to read a stream with", () => {
    const stop = listenForChanges(vi.fn(), { current: 0 }, { fetch: null });
    expect(vi.getTimerCount()).toBe(0);
    expect(() => stop()).not.toThrow();
  });

  it("stays quiet where the request cannot even be made", async () => {
    // On its own defaults: the global fetch and the api module's token. This
    // is what a test of another component gets, where a relative URL is
    // no address at all.
    const fetch = vi.fn(() => Promise.reject(new TypeError("Failed to parse URL from ./api/events")));
    vi.stubGlobal("fetch", fetch);
    const complaints = vi.spyOn(console, "error").mockImplementation(() => {});
    const refetch = vi.fn();
    const stop = listenForChanges(refetch, { current: 0 });
    await pass(3 * 60000);
    expect(fetch.mock.calls[0][0]).toBe("./api/events");
    expect(fetch.mock.calls.length).toBeGreaterThan(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(complaints).not.toHaveBeenCalled();
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
