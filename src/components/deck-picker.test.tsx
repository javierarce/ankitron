// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeckPicker } from "./deck-picker";

afterEach(cleanup);

const DECKS = ["Default", "French", "Spanish", "Spanish::Verbs"];

describe("DeckPicker", () => {
  it("renders the hierarchy and selects a deck on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DeckPicker decks={DECKS} value={null} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Verbs" }));
    expect(onChange).toHaveBeenCalledWith("Spanish::Verbs", false);
  });

  it("collapses a branch from its chevron", async () => {
    const user = userEvent.setup();
    render(<DeckPicker decks={DECKS} value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Verbs" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByRole("button", { name: "Verbs" })).toBeNull();
  });

  it("disables decks (with a reason) instead of hiding them", () => {
    render(
      <DeckPicker
        decks={DECKS}
        value={null}
        onChange={vi.fn()}
        disable={(d) => (d === "French" ? "nope" : null)}
      />,
    );

    const row = screen.getByRole("button", { name: "French" });
    expect((row as HTMLButtonElement).disabled).toBe(true);
    expect(row.getAttribute("title")).toBe("nope");
  });

  it("creates a new subdeck under the selected deck via its + button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DeckPicker
        decks={DECKS}
        value="Spanish"
        onChange={onChange}
        allowCreate
      />,
    );

    // Only the selected row offers subdeck creation.
    expect(
      screen.queryByRole("button", { name: "New subdeck of French" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "New subdeck of Spanish" }),
    );
    await user.type(screen.getByPlaceholderText("New deck name"), "Nouns{Enter}");

    expect(onChange).toHaveBeenCalledWith("Spanish::Nouns", true);
    // The pending deck shows up as a row in the tree, badged "new".
    expect(screen.getByRole("button", { name: "Nouns new" })).toBeTruthy();
  });

  it("offers no subdeck button on a pending new deck", () => {
    render(
      <DeckPicker
        decks={["French"]}
        value="Imported"
        onChange={vi.fn()}
        allowCreate
      />,
    );

    expect(
      screen.queryByRole("button", { name: "New subdeck of Imported" }),
    ).toBeNull();
  });

  it("creates a new top-level deck from the footer button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DeckPicker decks={DECKS} value={null} onChange={onChange} allowCreate />,
    );

    await user.click(screen.getByRole("button", { name: "New top-level deck" }));
    await user.type(screen.getByPlaceholderText("New deck name"), "Kanji{Enter}");

    expect(onChange).toHaveBeenCalledWith("Kanji", true);
  });

  it("discards a pending draft when another deck is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DeckPicker decks={DECKS} value={null} onChange={onChange} allowCreate />,
    );

    await user.click(screen.getByRole("button", { name: "New top-level deck" }));
    await user.type(screen.getByPlaceholderText("New deck name"), "Kanji{Enter}");
    expect(screen.getByRole("button", { name: "Kanji new" })).toBeTruthy();

    // Changing your mind removes the phantom deck instead of leaving it behind.
    await user.click(screen.getByRole("button", { name: "French" }));
    expect(screen.queryByRole("button", { name: "Kanji new" })).toBeNull();
  });

  it("replaces an earlier draft with a newer one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DeckPicker decks={DECKS} value={null} onChange={onChange} allowCreate />,
    );

    await user.click(screen.getByRole("button", { name: "New top-level deck" }));
    await user.type(screen.getByPlaceholderText("New deck name"), "Kanji{Enter}");
    await user.click(screen.getByRole("button", { name: "New top-level deck" }));
    await user.type(screen.getByPlaceholderText("New deck name"), "Hanzi{Enter}");

    expect(screen.getByRole("button", { name: "Hanzi new" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kanji new" })).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith("Hanzi", true);
  });

  it("hides top-level creation when allowCreateTopLevel is false", () => {
    render(
      <DeckPicker
        decks={DECKS}
        value="Spanish"
        onChange={vi.fn()}
        allowCreate
        allowCreateTopLevel={false}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "New top-level deck" }),
    ).toBeNull();
    // Subdeck creation on the selected row is still offered.
    expect(
      screen.getByRole("button", { name: "New subdeck of Spanish" }),
    ).toBeTruthy();
  });

  it("selects the existing deck when a typed name already exists", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DeckPicker decks={DECKS} value={null} onChange={onChange} allowCreate />,
    );

    await user.click(screen.getByRole("button", { name: "New top-level deck" }));
    await user.type(screen.getByPlaceholderText("New deck name"), "French{Enter}");

    expect(onChange).toHaveBeenCalledWith("French", false);
  });

  it("reports the top-level row as an empty path", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DeckPicker decks={DECKS} value={null} onChange={onChange} allowTopLevel />,
    );

    await user.click(
      screen.getByRole("button", { name: "Top level (no parent)" }),
    );
    expect(onChange).toHaveBeenCalledWith("", false);
  });

  it("renders a preselected deck that does not exist yet as pending-new", () => {
    render(
      <DeckPicker decks={["French"]} value="Imported::Deck" onChange={vi.fn()} />,
    );

    // Both the implicit ancestor and the leaf render as rows.
    expect(screen.getByRole("button", { name: /Imported/ })).toBeTruthy();
    const leaf = screen.getByRole("button", { name: /Deck/ });
    expect(leaf.getAttribute("data-selected")).toBe("true");
  });

  it("commits a typed draft when the pointer goes down outside the input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DeckPicker decks={DECKS} value={null} onChange={onChange} allowCreate />,
    );

    await user.click(screen.getByRole("button", { name: "New top-level deck" }));
    await user.type(screen.getByPlaceholderText("New deck name"), "Kanji");
    // e.g. pressing the dialog's (still disabled) confirm button, which fires
    // no blur — the capture-phase pointerdown must commit instead.
    fireEvent.pointerDown(document.body);

    expect(onChange).toHaveBeenCalledWith("Kanji", true);
    expect(screen.queryByPlaceholderText("New deck name")).toBeNull();
  });

  it("moves the Tab stop to the first match when the selection is filtered out", async () => {
    const user = userEvent.setup();
    const many = [...DECKS, "German", "Italian", "Japanese", "Korean"];
    render(<DeckPicker decks={many} value="Spanish" onChange={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("Filter decks…"), "fr");

    const row = screen.getByRole("button", { name: "French" });
    expect(row.tabIndex).toBe(0);
  });

  it("filters decks to a flat match list", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const many = [...DECKS, "German", "Italian", "Japanese", "Korean"];
    render(<DeckPicker decks={many} value={null} onChange={onChange} />);

    await user.type(screen.getByPlaceholderText("Filter decks…"), "verb");
    const match = screen.getByRole("button", { name: /Verbs/ });
    await user.click(match);

    expect(onChange).toHaveBeenCalledWith("Spanish::Verbs", false);
    // Selecting a match clears the filter and returns to the tree.
    expect((screen.getByPlaceholderText("Filter decks…") as HTMLInputElement).value).toBe("");
  });
});
