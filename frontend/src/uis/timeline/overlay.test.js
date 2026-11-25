import { describe, it, expect } from "vitest";
import {
  EMPTY_OVERLAY, withAdded, withoutAdded, withRemoved, withoutRemoved, withPatched, withoutPatched, applyOverlay, pruneOverlay,
} from "./overlay";

const feed = (id, start) => ({ id, start, end: start });
const lists = { feedings: [feed(1, "2026-10-22T08:00:00Z"), feed(2, "2026-10-22T11:00:00Z")], changes: [] };

describe("overlay", () => {
  it("leaves the lists alone when there is nothing on top", () => {
    expect(applyOverlay(lists, EMPTY_OVERLAY)).toBe(lists);
    expect(pruneOverlay(lists, EMPTY_OVERLAY)).toBe(EMPTY_OVERLAY);
  });

  it("shows a just-logged entry before the server lists it, and only once after", () => {
    const logged = feed(3, "2026-10-22T14:00:00Z");
    let overlay = withAdded(EMPTY_OVERLAY, "feedings", logged);
    expect(applyOverlay(lists, overlay).feedings.map((e) => e.id)).toEqual([1, 2, 3]);

    const refreshed = { ...lists, feedings: [...lists.feedings, logged] };
    expect(applyOverlay(refreshed, overlay).feedings.map((e) => e.id)).toEqual([1, 2, 3]);
    overlay = pruneOverlay(refreshed, overlay);
    expect(overlay).toBe(EMPTY_OVERLAY);
  });

  it("adds to a list the server sent nothing for", () => {
    const overlay = withAdded(EMPTY_OVERLAY, "sleeps", { id: 9, start: "2026-10-22T09:00:00Z" });
    expect(applyOverlay(lists, overlay).sleeps.map((e) => e.id)).toEqual([9]);
  });

  it("hides a deleted entry until the server stops listing it", () => {
    let overlay = withRemoved(EMPTY_OVERLAY, "feedings", 2);
    expect(applyOverlay(lists, overlay).feedings.map((e) => e.id)).toEqual([1]);
    // Still listed by a refresh that started before the delete: keep hiding.
    expect(pruneOverlay(lists, overlay)).toBe(overlay);
    const refreshed = { ...lists, feedings: [lists.feedings[0]] };
    expect(pruneOverlay(refreshed, overlay)).toBe(EMPTY_OVERLAY);
  });

  it("brings an entry back when its delete failed", () => {
    const overlay = withoutRemoved(withRemoved(EMPTY_OVERLAY, "feedings", 2), "feedings", 2);
    expect(applyOverlay(lists, overlay).feedings.map((e) => e.id)).toEqual([1, 2]);
  });

  it("shows a moved entry at its new time until the server agrees", () => {
    const moved = feed(2, "2026-10-22T10:55:00Z");
    let overlay = withPatched(EMPTY_OVERLAY, "feedings", moved);
    expect(applyOverlay(lists, overlay).feedings[1].start).toBe("2026-10-22T10:55:00Z");
    expect(pruneOverlay(lists, overlay)).toBe(overlay);

    // The server writes the same instant its own way.
    const refreshed = { ...lists, feedings: [lists.feedings[0], feed(2, "2026-10-22T12:55:00+02:00")] };
    overlay = pruneOverlay(refreshed, overlay);
    expect(overlay).toBe(EMPTY_OVERLAY);
  });

  it("drops a move when it failed", () => {
    const overlay = withoutPatched(withPatched(EMPTY_OVERLAY, "feedings", feed(2, "2026-10-22T10:55:00Z")), "feedings", 2);
    expect(applyOverlay(lists, overlay).feedings[1].start).toBe("2026-10-22T11:00:00Z");
  });

  it("keeps what is still pending when only part has arrived", () => {
    let overlay = withAdded(EMPTY_OVERLAY, "feedings", feed(3, "2026-10-22T14:00:00Z"));
    overlay = withRemoved(overlay, "feedings", 1);
    const refreshed = { ...lists, feedings: [...lists.feedings, feed(3, "2026-10-22T14:00:00Z")] };
    const pruned = pruneOverlay(refreshed, overlay);
    expect(pruned.added).toEqual({});
    expect(pruned.removed).toEqual(["feedings:1"]);
  });

  it("keeps an amount change until the server shows the new amount", () => {
    const bottle = { ...feed(2, "2026-10-22T11:00:00Z"), amount: 120 };
    const served = { ...lists, feedings: [lists.feedings[0], bottle] };
    let overlay = withPatched(EMPTY_OVERLAY, "feedings", { ...bottle, amount: 130 });
    expect(applyOverlay(served, overlay).feedings[1].amount).toBe(130);
    expect(pruneOverlay(served, overlay)).toBe(overlay);
    overlay = pruneOverlay({ ...served, feedings: [served.feedings[0], { ...bottle, amount: "130" }] }, overlay);
    expect(overlay).toBe(EMPTY_OVERLAY);
  });

  it("changes an entry the server has not listed yet", () => {
    const logged = feed(3, "2026-10-22T14:00:00Z");
    let overlay = withAdded(EMPTY_OVERLAY, "feedings", logged);
    overlay = withPatched(overlay, "feedings", feed(3, "2026-10-22T13:55:00Z"));
    // A refresh from before the entry existed must not bring the old time back.
    overlay = pruneOverlay(lists, overlay);
    expect(applyOverlay(lists, overlay).feedings[2].start).toBe("2026-10-22T13:55:00Z");
  });

  it("forgets an entry that was removed before the server ever listed it", () => {
    const timer = { id: 7, name: "sleep", start: "2026-10-22T13:00:00Z" };
    let overlay = withAdded(EMPTY_OVERLAY, "timers", timer);
    overlay = withRemoved(withoutAdded(overlay, "timers", 7), "timers", 7);
    expect(applyOverlay({ timers: [] }, overlay).timers).toEqual([]);
    // Nothing lists it, so nothing is left to hide — and it must not return.
    overlay = pruneOverlay({ timers: [] }, overlay);
    expect(overlay).toBe(EMPTY_OVERLAY);
    expect(withoutAdded(EMPTY_OVERLAY, "timers", 7)).toBe(EMPTY_OVERLAY);
  });

  it("follows a timer being paused", () => {
    const timer = { id: 7, name: "sleep", start: "2026-10-22T13:00:00Z", is_paused: false };
    const overlay = withPatched(EMPTY_OVERLAY, "timers", { ...timer, is_paused: true });
    expect(pruneOverlay({ timers: [timer] }, overlay)).toBe(overlay);
    expect(pruneOverlay({ timers: [{ ...timer, is_paused: true }] }, overlay)).toBe(EMPTY_OVERLAY);
  });
});
