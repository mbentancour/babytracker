import { test, expect } from "@playwright/test";

const QUEUE_KEY = "babytracker:writeQueue";

/**
 * IndexedDB-backed write queue Playwright tests.
 *
 * Verifies:
 *  - Queued writes persist in IndexedDB when offline (S03)
 *  - Queued writes replay on reconnect (S03)
 *  - Failed writes are marked with error details (R007)
 *
 * Note: idb-keyval uses DB name "keyval-store" with object store "keyval".
 */

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

/**
 * Clear any existing queue data from IndexedDB before a test.
 * idb-keyval uses DB "keyval-store" with store "keyval".
 */
async function clearQueue(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    if (!window.indexedDB) return;
    return new Promise<void>((resolve) => {
      const request = window.indexedDB.deleteDatabase("keyval-store");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}

/**
 * Read all queue operations from IndexedDB via page.evaluate.
 */
async function getQueueFromIndexedDB(
  page: import("@playwright/test").Page
): Promise<unknown[]> {
  return page.evaluate(async ({ key }) => {
    if (!window.indexedDB) return [];
    return new Promise<unknown[]>((resolve) => {
      const request = window.indexedDB.open("keyval-store");
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("keyval", "readonly");
        const store = tx.objectStore("keyval");
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          const data = getReq.result;
          resolve(Array.isArray(data) ? data : []);
        };
        getReq.onerror = () => resolve([]);
      };
      request.onerror = () => resolve([]);
    });
  }, { key: QUEUE_KEY });
}

/**
 * Add an operation to the IndexedDB write queue via page.evaluate.
 */
async function addToQueue(
  page: import("@playwright/test").Page,
  op: Record<string, unknown>
): Promise<{ success: boolean; queued: Record<string, unknown> | null }> {
  return page.evaluate(
    async ({ key, operation }) => {
      if (!window.indexedDB) return { success: false, queued: null };
      return new Promise<{ success: boolean; queued: Record<string, unknown> | null }>(
        (resolve) => {
          const request = window.indexedDB.open("keyval-store");
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("keyval", "readwrite");
            const store = tx.objectStore("keyval");

            const getReq = store.get(key);
            getReq.onsuccess = () => {
              const existing = getReq.result;
              const queue = Array.isArray(existing) ? existing : [];
              queue.push(operation);

              const putReq = store.put(queue, key);
              putReq.onsuccess = () => resolve({ success: true, queued: operation });
              putReq.onerror = () => resolve({ success: false, queued: null });
            };
            getReq.onerror = () => resolve({ success: false, queued: null });
          };
          request.onerror = () => resolve({ success: false, queued: null });
        }
      );
    },
    { key: QUEUE_KEY, operation: op }
  );
}

// ─── Suite 1: Write Queue Persistence ────────────────────────────────────────

test.describe("Write Queue - Persistence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearQueue(page);
  });

  test("queued writes persist in IndexedDB", async ({ page }) => {
    const feeding: Record<string, unknown> = {
      id: "POST-feedings-10001-test-persist",
      method: "POST",
      entity: "feedings",
      path: "feedings/",
      body: {
        child_id: "test-child-1",
        baby_food: "formula",
        amount: 120,
        type: "bottle",
      },
      timestamp: 1700000001000,
      status: "pending",
      retryCount: 0,
      error: null,
    };

    const result = await addToQueue(page, feeding);
    expect(result?.success).toBe(true);
    expect(result?.queued).toEqual(feeding);

    const queue = await getQueueFromIndexedDB(page);
    expect(queue.length).toBe(1);

    const stored = queue[0] as Record<string, unknown>;
    expect(stored.method).toBe("POST");
    expect(stored.entity).toBe("feedings");
    expect(stored.path).toBe("feedings/");
    expect(stored.status).toBe("pending");
    expect(stored.retryCount).toBe(0);
    expect(stored.error).toBe(null);
    expect(stored.timestamp).toBe(1700000001000);

    const body = stored.body as Record<string, unknown>;
    expect(body.child_id).toBe("test-child-1");
    expect(body.amount).toBe(120);
    expect(body.type).toBe("bottle");
  });

  test("multiple queued writes persist in correct order", async ({ page }) => {
    const operations = [
      {
        id: "POST-feedings-10001",
        method: "POST",
        entity: "feedings",
        path: "feedings/",
        body: { type: "bottle" },
        timestamp: 1700000001000,
        status: "pending",
        retryCount: 0,
        error: null,
      },
      {
        id: "POST-sleep-10002",
        method: "POST",
        entity: "sleep",
        path: "sleep/",
        body: { start: "2024-01-01T10:00:00Z" },
        timestamp: 1700000002000,
        status: "pending",
        retryCount: 0,
        error: null,
      },
      {
        id: "DELETE-timers-10003",
        method: "DELETE",
        entity: "timers",
        path: "timers/1/",
        body: null,
        timestamp: 1700000003000,
        status: "pending",
        retryCount: 0,
        error: null,
      },
    ];

    for (const op of operations) {
      const res = await addToQueue(page, op);
      expect(res?.success).toBe(true);
    }

    const queue = await getQueueFromIndexedDB(page);
    expect(queue.length).toBe(3);

    for (let i = 0; i < operations.length; i++) {
      expect(queue[i]).toEqual(operations[i]);
    }
  });
});

// ─── Suite 2: Reconnect Replay ──────────────────────────────────────────────

test.describe("Write Queue - Reconnect Replay", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearQueue(page);
  });

  test("queued writes replay on reconnect", async ({ page }) => {
    const feeding: Record<string, unknown> = {
      id: "POST-feedings-replay-001",
      method: "POST",
      entity: "feedings",
      path: "feedings/",
      body: { type: "breast", side: "left", duration: 15 },
      timestamp: 1700000010000,
      status: "pending",
      retryCount: 0,
      error: null,
    };

    await addToQueue(page, feeding);
    let queue = await getQueueFromIndexedDB(page);
    expect(queue.length).toBe(1);

    let replayRequestCount = 0;
    await page.route("**/api/feedings/**", async (route) => {
      replayRequestCount++;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "replay-created", ...feeding }),
      });
    });

    const replayResult = await page.evaluate(
      async ({ key }) => {
        if (!window.indexedDB) return { success: [], failed: [] };
        return new Promise<Record<string, unknown[]>>((resolve) => {
          const dbReq = window.indexedDB.open("keyval-store");
          dbReq.onsuccess = () => {
            const db = dbReq.result;
            const tx1 = db.transaction("keyval", "readonly");
            const store1 = tx1.objectStore("keyval");
            const getReq = store1.get(key);
            getReq.onsuccess = () => {
              const data = getReq.result;
              const queue = Array.isArray(data) ? data : [];
              const pending = queue.filter(
                (op: Record<string, unknown>) => op.status === "pending"
              );

              const success: Record<string, unknown>[] = [];
              const failed: Record<string, unknown>[] = [];

              void (async () => {
                for (const op of pending) {
                  try {
                    const fetchOptions: RequestInit = {
                      method: op.method as string,
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                    };
                    if (op.body !== null && op.body !== undefined) {
                      fetchOptions.body = JSON.stringify(op.body);
                    }

                    const response = await fetch(`./api/${op.path}`, fetchOptions);

                    if (response.ok || response.status === 204) {
                      const tx2 = db.transaction("keyval", "readwrite");
                      const store2 = tx2.objectStore("keyval");
                      const filtered = queue.filter(
                        (o: Record<string, unknown>) => o.id !== op.id
                      );
                      await new Promise<void>((res) => {
                        const p = store2.put(filtered, key);
                        p.onsuccess = () => res();
                        p.onerror = () => res();
                      });
                      success.push(op);
                    } else {
                      const text = await response.text().catch(() => "");
                      const idx = queue.findIndex(
                        (o: Record<string, unknown>) => o.id === op.id
                      );
                      if (idx !== -1) {
                        queue[idx].status = "failed";
                        queue[idx].error = `HTTP ${response.status}: ${text}`;
                        queue[idx].retryCount = (queue[idx].retryCount || 0) + 1;
                      }
                      failed.push(queue[idx]);
                    }
                  } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const idx = queue.findIndex(
                      (o: Record<string, unknown>) => o.id === op.id
                    );
                    if (idx !== -1) {
                      queue[idx].status = "failed";
                      queue[idx].error = message;
                      queue[idx].retryCount = (queue[idx].retryCount || 0) + 1;
                    }
                    failed.push(queue[idx]);
                  }
                }

                const tx3 = db.transaction("keyval", "readwrite");
                const store3 = tx3.objectStore("keyval");
                await new Promise<void>((res) => {
                  const p = store3.put(queue, key);
                  p.onsuccess = () => res();
                  p.onerror = () => res();
                });
                resolve({ success, failed });
              })();
            };
            getReq.onerror = () => resolve({ success: [], failed: [] });
          };
          dbReq.onerror = () => resolve({ success: [], failed: [] });
        });
      },
      { key: QUEUE_KEY }
    );

    await page.waitForTimeout(500);

    queue = await getQueueFromIndexedDB(page);
    expect(queue.length).toBe(0);
    expect(replayRequestCount).toBe(1);
    expect(replayResult.success.length).toBe(1);
    expect(replayResult.failed.length).toBe(0);
  });

  test("multiple queued writes replay sequentially", async ({ page }) => {
    const operations = [
      {
        id: "POST-feedings-multi-001",
        method: "POST",
        entity: "feedings",
        path: "feedings/",
        body: { type: "bottle" },
        timestamp: 1700000001000,
        status: "pending",
        retryCount: 0,
        error: null,
      },
      {
        id: "POST-sleep-multi-002",
        method: "POST",
        entity: "sleep",
        path: "sleep/",
        body: { start: "2024-01-01T12:00:00Z" },
        timestamp: 1700000002000,
        status: "pending",
        retryCount: 0,
        error: null,
      },
    ];

    for (const op of operations) {
      await addToQueue(page, op);
    }

    let replayRequestCount = 0;
    await page.route("**/api/feedings/**", async (route) => {
      replayRequestCount++;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "replay-feeding" }),
      });
    });
    await page.route("**/api/sleep/**", async (route) => {
      replayRequestCount++;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "replay-sleep" }),
      });
    });

    await page.evaluate(
      async ({ key }) => {
        if (!window.indexedDB) return;
        return new Promise<void>((resolve) => {
          const dbReq = window.indexedDB.open("keyval-store");
          dbReq.onsuccess = () => {
            const db = dbReq.result;
            const tx = db.transaction("keyval", "readonly");
            const store = tx.objectStore("keyval");
            const getReq = store.get(key);
            getReq.onsuccess = () => {
              const data = getReq.result;
              const queue = Array.isArray(data) ? data : [];
              const pending = queue.filter(
                (op: Record<string, unknown>) => op.status === "pending"
              );

              void (async () => {
                for (const op of pending) {
                  try {
                    const response = await fetch(`./api/${op.path}`, {
                      method: op.method as string,
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body:
                        op.body !== null && op.body !== undefined
                          ? JSON.stringify(op.body)
                          : undefined,
                    });
                    if (response.ok || response.status === 204) {
                      const tx2 = db.transaction("keyval", "readwrite");
                      const store2 = tx2.objectStore("keyval");
                      const filtered = queue.filter(
                        (o: Record<string, unknown>) => o.id !== op.id
                      );
                      await new Promise<void>((res) => {
                        const p = store2.put(filtered, key);
                        p.onsuccess = () => res();
                        p.onerror = () => res();
                      });
                    }
                  } catch {
                    // ignore
                  }
                }
                resolve();
              })();
            };
            getReq.onerror = () => resolve();
          };
          dbReq.onerror = () => resolve();
        });
      },
      { key: QUEUE_KEY }
    );

    await page.waitForTimeout(500);

    const queue = await getQueueFromIndexedDB(page);
    expect(queue.length).toBe(0);
    expect(replayRequestCount).toBe(2);
  });
});

// ─── Suite 3: Failed Write Marking ──────────────────────────────────────────

test.describe("Write Queue - Failed Write Marking", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await clearQueue(page);
  });

  test("failed writes are marked with error details", async ({ page }) => {
    const feeding: Record<string, unknown> = {
      id: "POST-feedings-fail-001",
      method: "POST",
      entity: "feedings",
      path: "feedings/",
      body: { type: "bottle", amount: 200 },
      timestamp: 1700000020000,
      status: "pending",
      retryCount: 0,
      error: null,
    };

    await addToQueue(page, feeding);

    await page.route("**/api/feedings/**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Service temporarily unavailable" }),
      });
    });

    const replayResult = await page.evaluate(
      async ({ key }) => {
        if (!window.indexedDB) return { success: [], failed: [] };
        return new Promise<Record<string, unknown[]>>((resolve) => {
          const dbReq = window.indexedDB.open("keyval-store");
          dbReq.onsuccess = () => {
            const db = dbReq.result;
            const tx1 = db.transaction("keyval", "readonly");
            const store1 = tx1.objectStore("keyval");
            const getReq = store1.get(key);
            getReq.onsuccess = () => {
              const data = getReq.result;
              const queue = Array.isArray(data) ? data : [];
              const pending = queue.filter(
                (op: Record<string, unknown>) => op.status === "pending"
              );

              const success: Record<string, unknown>[] = [];
              const failed: Record<string, unknown>[] = [];

              void (async () => {
                for (const op of pending) {
                  try {
                    const response = await fetch(`./api/${op.path}`, {
                      method: op.method as string,
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body:
                        op.body !== null && op.body !== undefined
                          ? JSON.stringify(op.body)
                          : undefined,
                    });

                    if (response.ok || response.status === 204) {
                      const tx2 = db.transaction("keyval", "readwrite");
                      const store2 = tx2.objectStore("keyval");
                      const filtered = queue.filter(
                        (o: Record<string, unknown>) => o.id !== op.id
                      );
                      await new Promise<void>((res) => {
                        const p = store2.put(filtered, key);
                        p.onsuccess = () => res();
                        p.onerror = () => res();
                      });
                      success.push(op);
                    } else {
                      const text = await response.text().catch(() => "");
                      const idx = queue.findIndex(
                        (o: Record<string, unknown>) => o.id === op.id
                      );
                      if (idx !== -1) {
                        queue[idx].status = "failed";
                        queue[idx].error = `HTTP ${response.status}: ${text}`;
                        queue[idx].retryCount = (queue[idx].retryCount || 0) + 1;
                      }
                      failed.push(queue[idx]);
                    }
                  } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const idx = queue.findIndex(
                      (o: Record<string, unknown>) => o.id === op.id
                    );
                    if (idx !== -1) {
                      queue[idx].status = "failed";
                      queue[idx].error = message;
                      queue[idx].retryCount = (queue[idx].retryCount || 0) + 1;
                    }
                    failed.push(queue[idx]);
                  }
                }

                const tx3 = db.transaction("keyval", "readwrite");
                const store3 = tx3.objectStore("keyval");
                await new Promise<void>((res) => {
                  const p = store3.put(queue, key);
                  p.onsuccess = () => res();
                  p.onerror = () => res();
                });
                resolve({ success, failed });
              })();
            };
            getReq.onerror = () => resolve({ success: [], failed: [] });
          };
          dbReq.onerror = () => resolve({ success: [], failed: [] });
        });
      },
      { key: QUEUE_KEY }
    );

    await page.waitForTimeout(500);

    const queue = await getQueueFromIndexedDB(page);
    expect(queue.length).toBe(0);
    expect(replayResult.success.length).toBe(0);
    expect(replayResult.failed.length).toBe(1);

    const failed = replayResult.failed[0] as Record<string, unknown>;
    expect(failed.status).toBe("failed");
    expect(failed.retryCount).toBe(1);
    expect(typeof failed.error).toBe("string");
    expect((failed.error as string).length).toBeGreaterThan(0);
    expect(failed.error).toContain("503");
  });

  test("failed write carries HTTP error message for UI display", async ({ page }) => {
    const timerDelete: Record<string, unknown> = {
      id: "DELETE-timers-fail-001",
      method: "DELETE",
      entity: "timers",
      path: "timers/42/",
      body: null,
      timestamp: 1700000030000,
      status: "pending",
      retryCount: 0,
      error: null,
    };

    await addToQueue(page, timerDelete);

    await page.route("**/api/timers/**", async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Timer not found" }),
      });
    });

    const replayResult = await page.evaluate(
      async ({ key }) => {
        if (!window.indexedDB) return { failed: [] };
        return new Promise<Record<string, unknown[]>>((resolve) => {
          const dbReq = window.indexedDB.open("keyval-store");
          dbReq.onsuccess = () => {
            const db = dbReq.result;
            const tx1 = db.transaction("keyval", "readonly");
            const store1 = tx1.objectStore("keyval");
            const getReq = store1.get(key);
            getReq.onsuccess = () => {
              const data = getReq.result;
              const queue = Array.isArray(data) ? data : [];
              const pending = queue.filter(
                (op: Record<string, unknown>) => op.status === "pending"
              );

              void (async () => {
                for (const op of pending) {
                  try {
                    const response = await fetch(`./api/${op.path}`, {
                      method: op.method as string,
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                    });

                    if (response.ok || response.status === 204) {
                      const tx2 = db.transaction("keyval", "readwrite");
                      const store2 = tx2.objectStore("keyval");
                      const filtered = queue.filter(
                        (o: Record<string, unknown>) => o.id !== op.id
                      );
                      await new Promise<void>((res) => {
                        const p = store2.put(filtered, key);
                        p.onsuccess = () => res();
                        p.onerror = () => res();
                      });
                    } else {
                      const text = await response.text().catch(() => "");
                      const idx = queue.findIndex(
                        (o: Record<string, unknown>) => o.id === op.id
                      );
                      if (idx !== -1) {
                        queue[idx].status = "failed";
                        queue[idx].error = `HTTP ${response.status}: ${text}`;
                        queue[idx].retryCount = (queue[idx].retryCount || 0) + 1;
                      }
                    }
                  } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const idx = queue.findIndex(
                      (o: Record<string, unknown>) => o.id === op.id
                    );
                    if (idx !== -1) {
                      queue[idx].status = "failed";
                      queue[idx].error = message;
                      queue[idx].retryCount = (queue[idx].retryCount || 0) + 1;
                    }
                  }
                }

                const tx3 = db.transaction("keyval", "readwrite");
                const store3 = tx3.objectStore("keyval");
                await new Promise<void>((res) => {
                  const p = store3.put(queue, key);
                  p.onsuccess = () => res();
                  p.onerror = () => res();
                });
                resolve({
                  failed: pending.map(() => queue.find((o) => o.id === pending[0].id)),
                });
              })();
            };
            getReq.onerror = () => resolve({ failed: [] });
          };
          dbReq.onerror = () => resolve({ failed: [] });
        });
      },
      { key: QUEUE_KEY }
    );

    await page.waitForTimeout(500);

    const failed = replayResult.failed[0] as Record<string, unknown> | undefined;
    expect(failed).toBeDefined();
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("400");
    expect(failed?.error).toContain("Timer not found");
  });
});