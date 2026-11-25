import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listenForChanges } from "./useBabyData";

class FakeSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.closed = false;
    FakeSource.last = this;
  }
  close() { this.closed = true; }
  say() { this.onmessage({ data: "{}" }); }
}

describe("listenForChanges", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 14, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  const start = (lastFetch = 0) => {
    const refetch = vi.fn();
    const lastFetchRef = { current: lastFetch };
    const stop = listenForChanges(refetch, lastFetchRef, FakeSource);
    return { refetch, lastFetchRef, stop, source: FakeSource.last };
  };

  it("opens the server's event stream", () => {
    const { source } = start();
    expect(source.url).toBe("./api/events");
  });

  it("ignores the first message, which only says the stream is open", () => {
    const { refetch, source } = start();
    source.say();
    vi.advanceTimersByTime(5000);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("refetches shortly after a change elsewhere", () => {
    const { refetch, source } = start();
    source.say();
    source.say();
    expect(refetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("rolls a burst of changes into one refetch", () => {
    const { refetch, source } = start();
    source.say();
    for (let i = 0; i < 5; i++) {
      source.say();
      vi.advanceTimersByTime(100);
    }
    expect(refetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("skips the refetch on the screen that just fetched after its own save", () => {
    const { refetch, source, lastFetchRef } = start();
    source.say();
    lastFetchRef.current = Date.now();
    source.say();
    vi.advanceTimersByTime(300);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("refetches after a reconnect, when changes may have been missed", () => {
    const { refetch, source } = start();
    source.say(); // connected
    source.say(); // connected again after a drop
    vi.advanceTimersByTime(300);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("closes the stream and drops a pending refetch when stopped", () => {
    const { refetch, source, stop } = start();
    source.say();
    source.say();
    stop();
    vi.advanceTimersByTime(1000);
    expect(source.closed).toBe(true);
    expect(refetch).not.toHaveBeenCalled();
  });

  it("does nothing where EventSource does not exist", () => {
    const refetch = vi.fn();
    const stop = listenForChanges(refetch, { current: 0 }, undefined);
    expect(() => stop()).not.toThrow();
  });
});
