import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ArrangeGrid, ArrangeSlot, arrange, moved, withHidden, isArranged } from "./ArrangeGrid";
import { I18nProvider } from "../utils/i18n";
import { PreferencesProvider } from "../utils/preferences";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const IDS = ["a", "b", "c", "d"];

describe("arrange", () => {
  it("keeps the built-in order when nothing was saved", () => {
    expect(arrange(IDS, undefined)).toEqual({ order: IDS, visible: IDS, hidden: [] });
  });

  it("follows the saved order and sets the hidden cards apart", () => {
    expect(arrange(IDS, { order: ["d", "c", "b", "a"], hidden: ["c"] })).toEqual({
      order: ["d", "c", "b", "a"],
      visible: ["d", "b", "a"],
      hidden: ["c"],
    });
  });

  it("keeps the place of a saved card the grid does not have right now", () => {
    const result = arrange(["a", "b", "c"], { order: ["c", "gone", "a", "b"], hidden: ["gone"] });
    expect(result.order).toEqual(["c", "gone", "a", "b"]);
    expect(result.visible).toEqual(["c", "a", "b"]);
    expect(result.hidden).toEqual([]);
  });

  it("puts a card the saved order has never seen after the last of the cards it follows", () => {
    // Saved when there were only "a" and "b", swapped: the new ones follow both.
    expect(arrange(IDS, { order: ["b", "a"] }).visible).toEqual(["b", "a", "c", "d"]);
    // A later card moved to the front does not pull the newcomer forward…
    expect(arrange(IDS, { order: ["d", "a", "b"] }).visible).toEqual(["d", "a", "b", "c"]);
    // …and an earlier one moved to the back takes it along.
    expect(arrange(IDS, { order: ["b", "d", "a"] }).visible).toEqual(["b", "d", "a", "c"]);
    // A card that follows nothing comes first.
    expect(arrange(["new", "a", "b"], { order: ["b", "a"] }).visible).toEqual(["new", "b", "a"]);
  });

  it("slots a newcomer in beside its built-in neighbours when they have not moved", () => {
    // "z" was moved to the front; "c" still goes between "b" and "d".
    expect(arrange(["a", "b", "c", "d", "z"], { order: ["z", "a", "b", "d"] }).visible).toEqual(["z", "a", "b", "c", "d"]);
  });

  it("counts a hidden card as a place to follow", () => {
    const result = arrange(IDS, { order: ["a", "b", "d"], hidden: ["b"] });
    expect(result.order).toEqual(["a", "b", "c", "d"]);
    expect(result.visible).toEqual(["a", "c", "d"]);
  });

  it("shrugs off a saved value that is not what it should be", () => {
    expect(arrange(IDS, { order: "nonsense", hidden: 7 })).toEqual({ order: IDS, visible: IDS, hidden: [] });
    expect(arrange(IDS, { order: ["b", "b", "a", "c", "d"] }).visible).toEqual(["b", "a", "c", "d"]);
    expect(arrange(IDS, null).visible).toEqual(IDS);
  });
});

describe("moved", () => {
  it("swaps a card with the one next to it", () => {
    expect(moved(IDS, undefined, "b", -1)).toEqual({ order: ["b", "a", "c", "d"], hidden: [] });
    expect(moved(IDS, undefined, "b", 1)).toEqual({ order: ["a", "c", "b", "d"], hidden: [] });
  });

  it("steps over a hidden card, which stays where it is", () => {
    const saved = { order: [], hidden: ["b"] };
    expect(moved(IDS, saved, "c", -1)).toEqual({ order: ["c", "b", "a", "d"], hidden: ["b"] });
  });

  it("leaves things as they are at either end", () => {
    const saved = { order: ["d", "c", "b", "a"], hidden: [] };
    expect(moved(IDS, saved, "d", -1)).toBe(saved);
    expect(moved(IDS, saved, "a", 1)).toBe(saved);
    expect(moved(IDS, undefined, "a", -1)).toBeUndefined();
    expect(moved(IDS, saved, "unknown", 1)).toBe(saved);
  });

  it("keeps cards the grid does not have right now, and their hidden mark", () => {
    const saved = { order: ["a", "gone", "b", "c"], hidden: ["gone"] };
    expect(moved(["a", "b", "c"], saved, "c", -1)).toEqual({ order: ["a", "gone", "c", "b"], hidden: ["gone"] });
  });
});

describe("withHidden", () => {
  it("hides a card and shows it again", () => {
    const hidden = withHidden(undefined, "b", true);
    expect(arrange(IDS, hidden)).toMatchObject({ visible: ["a", "c", "d"], hidden: ["b"] });
    expect(arrange(IDS, withHidden(hidden, "b", false))).toMatchObject({ visible: IDS, hidden: [] });
  });

  it("does not turn the built-in order into a chosen one", () => {
    expect(withHidden(undefined, "b", true)).toEqual({ order: [], hidden: ["b"] });
  });

  it("never lists a card twice, and leaves the saved order alone", () => {
    const saved = { order: ["c", "a"], hidden: ["b"] };
    expect(withHidden(saved, "b", true)).toEqual({ order: ["c", "a"], hidden: ["b"] });
    expect(withHidden(saved, "d", true)).toEqual({ order: ["c", "a"], hidden: ["b", "d"] });
  });
});

describe("isArranged", () => {
  it("is false for the built-in arrangement, however it is written down", () => {
    expect(isArranged(IDS, undefined)).toBe(false);
    expect(isArranged(IDS, { order: [], hidden: [] })).toBe(false);
    expect(isArranged(IDS, { order: IDS, hidden: [] })).toBe(false);
    // Hiding a card the grid does not have changes nothing on screen.
    expect(isArranged(IDS, { order: [], hidden: ["gone"] })).toBe(false);
  });

  it("is true once a card is moved or hidden", () => {
    expect(isArranged(IDS, { order: ["b", "a", "c", "d"], hidden: [] })).toBe(true);
    expect(isArranged(IDS, { order: [], hidden: ["d"] })).toBe(true);
  });
});

const PREFS_KEY = "babytracker_preferences";
const savedLayout = () => JSON.parse(localStorage.getItem(PREFS_KEY)).layouts.test;

function Grid({ cards = ["Alpha", "Bravo", "Charlie"] }) {
  return (
    <I18nProvider>
      <PreferencesProvider>
        <ArrangeGrid layoutKey="test" hint="Arrange the cards.">
          {["Alpha", "Bravo", "Charlie"].map((name) => cards.includes(name) && (
            <ArrangeSlot key={name} id={name.toLowerCase()} title={name}>
              <div data-testid="card">{name} card</div>
            </ArrangeSlot>
          ))}
        </ArrangeGrid>
      </PreferencesProvider>
    </I18nProvider>
  );
}

const cards = () => screen.queryAllByTestId("card").map((card) => card.textContent);
const tiles = () => [...document.querySelectorAll(".arrange-tile .arrange-title")].map((title) => title.textContent);
const press = (name) => fireEvent.click(screen.getByRole("button", { name }));

describe("ArrangeGrid", () => {
  it("shows the cards as they come until someone customizes", () => {
    render(<Grid />);
    expect(cards()).toEqual(["Alpha card", "Bravo card", "Charlie card"]);
    expect(screen.getByRole("button", { name: "Customize" })).toBeTruthy();
    expect(screen.queryByText("Arrange the cards.")).toBeNull();
    expect(localStorage.getItem(PREFS_KEY)).toBeNull();
  });

  it("turns the cards into tiles while arranging, and back", () => {
    render(<Grid />);
    press("Customize");
    expect(cards()).toEqual([]);
    expect(tiles()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(screen.getByText("Arrange the cards.")).toBeTruthy();
    // Nothing has been changed yet, so there is nothing to reset.
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    press("Done");
    expect(cards()).toEqual(["Alpha card", "Bravo card", "Charlie card"]);
    expect(screen.getByRole("button", { name: "Customize" })).toBeTruthy();
  });

  it("moves a card earlier or later and remembers it", () => {
    render(<Grid />);
    press("Customize");
    press("Move Charlie earlier");
    expect(tiles()).toEqual(["Alpha", "Charlie", "Bravo"]);
    press("Move Alpha later");
    expect(tiles()).toEqual(["Charlie", "Alpha", "Bravo"]);
    press("Done");
    expect(cards()).toEqual(["Charlie card", "Alpha card", "Bravo card"]);
    expect(savedLayout().order).toEqual(["charlie", "alpha", "bravo"]);

    // The same device, later.
    cleanup();
    render(<Grid />);
    expect(cards()).toEqual(["Charlie card", "Alpha card", "Bravo card"]);
  });

  it("cannot move the first card earlier or the last one later", () => {
    render(<Grid />);
    press("Customize");
    expect(screen.getByRole("button", { name: "Move Alpha earlier" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Move Alpha later" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Move Charlie later" }).disabled).toBe(true);
  });

  it("hides a card, says so, and brings it back", () => {
    render(<Grid />);
    press("Customize");
    press("Hide Bravo");
    expect(tiles()).toEqual(["Alpha", "Charlie"]);
    const waiting = document.querySelector(".arrange-hidden");
    expect(within(waiting).getByRole("button", { name: "Show Bravo" })).toBeTruthy();
    press("Done");
    expect(cards()).toEqual(["Alpha card", "Charlie card"]);
    expect(screen.getByText("1 hidden")).toBeTruthy();
    expect(savedLayout().hidden).toEqual(["bravo"]);

    press("Customize");
    press("Show Bravo");
    expect(tiles()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(document.querySelector(".arrange-hidden")).toBeNull();
    press("Done");
    expect(cards()).toEqual(["Alpha card", "Bravo card", "Charlie card"]);
    expect(screen.queryByText(/hidden/)).toBeNull();
  });

  it("can hide every card and still offers the way back", () => {
    render(<Grid />);
    press("Customize");
    press("Hide Alpha");
    press("Hide Bravo");
    press("Hide Charlie");
    press("Done");
    expect(cards()).toEqual([]);
    expect(screen.getByText("3 hidden")).toBeTruthy();
    press("Customize");
    press("Show Bravo");
    press("Done");
    expect(cards()).toEqual(["Bravo card"]);
  });

  it("resets to the built-in arrangement", () => {
    render(<Grid />);
    press("Customize");
    press("Move Charlie earlier");
    press("Hide Alpha");
    press("Reset");
    expect(tiles()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)).layouts).toEqual({});
    press("Done");
    expect(cards()).toEqual(["Alpha card", "Bravo card", "Charlie card"]);
  });

  it("leaves other grids' arrangements alone", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ layouts: { other: { order: ["x"], hidden: ["y"] } } }));
    render(<Grid />);
    press("Customize");
    press("Hide Alpha");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)).layouts.other).toEqual({ order: ["x"], hidden: ["y"] });
    press("Reset");
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)).layouts).toEqual({ other: { order: ["x"], hidden: ["y"] } });
  });

  it("keeps a card hidden and in its place while the grid does not have it", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ layouts: { test: { order: ["charlie", "bravo", "alpha"], hidden: ["bravo"] } } }));
    const { rerender } = render(<Grid cards={["Alpha", "Charlie"]} />);
    expect(cards()).toEqual(["Charlie card", "Alpha card"]);
    // Rearranging the two that are there must not forget the third.
    press("Customize");
    expect(tiles()).toEqual(["Charlie", "Alpha"]);
    press("Move Alpha earlier");
    press("Done");
    expect(savedLayout()).toEqual({ order: ["alpha", "bravo", "charlie"], hidden: ["bravo"] });

    rerender(<Grid />);
    expect(cards()).toEqual(["Alpha card", "Charlie card"]);
    expect(screen.getByText("1 hidden")).toBeTruthy();
  });

  it("renders nothing at all when it has no cards", () => {
    const { container } = render(<Grid cards={[]} />);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Customize" })).toBeNull();
  });

  it("ignores a saved arrangement that is not one", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ layouts: { test: "sideways" } }));
    render(<Grid />);
    expect(cards()).toEqual(["Alpha card", "Bravo card", "Charlie card"]);
    localStorage.setItem(PREFS_KEY, JSON.stringify({ layouts: "sideways" }));
    cleanup();
    render(<Grid />);
    expect(cards()).toEqual(["Alpha card", "Bravo card", "Charlie card"]);
  });
});
