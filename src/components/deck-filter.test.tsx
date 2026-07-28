// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { DeckFilter } from "./deck-filter";

const DECKS = [
  "French",
  "German",
  "German::Survival",
  "German::Survival::Phrases",
  "Spanish",
  "Spanish::Verbs",
];

function setup(value = "", decks: string[] | null = DECKS) {
  const onChange = vi.fn();
  render(
    <DeckFilter
      decks={decks}
      value={value}
      onChange={onChange}
      label="Filter stats by deck"
    />,
  );
  return { onChange, trigger: screen.getByLabelText("Filter stats by deck") };
}

const openMenu = (trigger: HTMLElement) => {
  fireEvent.click(trigger);
  return screen.getByRole("listbox");
};

const search = () => screen.getByLabelText("Search decks");
const optionNames = () =>
  screen
    .getAllByRole("option")
    .map((o) => o.textContent?.replace(/\s+/g, " ").trim());

describe("DeckFilter", () => {
  afterEach(cleanup);

  it("shows the current scope on the trigger", () => {
    const { trigger } = setup("German::Survival");

    expect(trigger.textContent?.replace(/\s+/g, " ")).toContain(
      "German / Survival",
    );
  });

  // The ancestors truncate; the leaf must not, or a deep path reads as
  // "German / Survival / Are you cra…" and loses the deck's actual name.
  it("keeps the leaf name un-truncated on the trigger", () => {
    const { trigger } = setup("German::Survival::Phrases");

    const leaf = within(trigger).getByText("Phrases");
    expect(leaf.className).toContain("shrink-0");
    expect(leaf.className).not.toContain("truncate");
  });

  it("falls back to the all-decks label when nothing is selected", () => {
    const { trigger } = setup("");

    expect(trigger.textContent).toContain("All decks");
  });

  it("lists every deck plus the all-decks option when opened", () => {
    const { trigger } = setup();
    openMenu(trigger);

    expect(optionNames()).toEqual([
      "All decks",
      "French",
      "German",
      "German / Survival",
      "German / Survival / Phrases",
      "Spanish",
      "Spanish / Verbs",
    ]);
  });

  // The reason this replaced a native <select>: finding a deck in a large
  // collection should take a couple of keystrokes, not a scroll.
  it("narrows the list as you type, matching anywhere in the path", () => {
    const { trigger } = setup();
    openMenu(trigger);

    fireEvent.change(search(), { target: { value: "verbs" } });

    expect(optionNames()).toEqual(["Spanish / Verbs"]);
  });

  it("matches a parent segment, keeping its whole subtree", () => {
    const { trigger } = setup();
    openMenu(trigger);

    fireEvent.change(search(), { target: { value: "german" } });

    expect(optionNames()).toEqual([
      "German",
      "German / Survival",
      "German / Survival / Phrases",
    ]);
  });

  it("ignores case and accents", () => {
    render(
      <DeckFilter
        decks={["Español", "Français"]}
        value=""
        onChange={vi.fn()}
        label="Pick"
      />,
    );
    fireEvent.click(screen.getByLabelText("Pick"));

    fireEvent.change(screen.getByLabelText("Search decks"), {
      target: { value: "espanol" },
    });

    expect(optionNames()).toEqual(["Español"]);
  });

  it("selects a deck on click and closes", () => {
    const { trigger, onChange } = setup();
    const list = openMenu(trigger);

    fireEvent.click(within(list).getByText("Verbs"));

    expect(onChange).toHaveBeenCalledWith("Spanish::Verbs");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("selects with the keyboard", () => {
    const { trigger, onChange } = setup();
    openMenu(trigger);

    fireEvent.change(search(), { target: { value: "french" } });
    fireEvent.keyDown(search(), { key: "ArrowDown" });
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("French");
  });

  // Clearing the filter is the most common action after narrowing it, so the
  // all-decks option stays reachable rather than being filtered away.
  it("keeps the all-decks option at the top and selectable", () => {
    const { trigger, onChange } = setup("Spanish");
    openMenu(trigger);

    fireEvent.keyDown(search(), { key: "Home" });
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("");
  });

  // "All decks" is dropped from a filtered list rather than pinned to it: as
  // the first option it would take the Enter press, so typing a deck name and
  // hitting Enter would clear the filter instead of applying it.
  it("hands Enter to the deck you searched for, not the all-decks option", () => {
    const { trigger, onChange } = setup("French");
    openMenu(trigger);

    fireEvent.change(search(), { target: { value: "phrases" } });
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("German::Survival::Phrases");
  });

  it("offers the all-decks option when the query matches its label", () => {
    const { trigger } = setup("French");
    openMenu(trigger);

    fireEvent.change(search(), { target: { value: "all" } });

    expect(optionNames()).toContain("All decks");
  });

  // A mistyped search shouldn't cost the whole interaction.
  it("clears the query on the first Escape and closes on the second", () => {
    const { trigger } = setup();
    openMenu(trigger);
    fireEvent.change(search(), { target: { value: "zzz" } });

    fireEvent.keyDown(search(), { key: "Escape" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect((search() as HTMLInputElement).value).toBe("");

    fireEvent.keyDown(search(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says so when nothing matches", () => {
    const { trigger } = setup();
    openMenu(trigger);

    fireEvent.change(search(), { target: { value: "zzz" } });

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/no decks match/i)).toBeTruthy();
  });

  it("marks the selected deck for assistive tech", () => {
    const { trigger } = setup("French");
    openMenu(trigger);

    const selected = screen
      .getAllByRole("option")
      .filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("French");
  });

  it("reports loading rather than an empty list", () => {
    const { trigger } = setup("", null);
    openMenu(trigger);

    expect(screen.getByText(/loading decks/i)).toBeTruthy();
  });

  it("closes on an outside click", () => {
    const { trigger } = setup();
    openMenu(trigger);

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
