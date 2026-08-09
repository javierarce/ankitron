// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Note } from "@/lib/types";

vi.mock("@/lib/anki-fetch", () => ({ ankiFetch: vi.fn(async () => []) }));

vi.mock("@/hooks/use-deck-names", () => ({
  useDeckNames: () => ["Spanish", "Spanish::Verbs", "German"],
}));

// The rich-text editor is ProseMirror-based and irrelevant here; stand it in
// with a plain textarea so the form renders in jsdom.
vi.mock("./card-editor", () => ({
  CardEditor: ({ value }: { value: string }) => (
    <textarea readOnly value={value} />
  ),
}));

import { CardForm } from "./card-form";

afterEach(cleanup);

const note = (tags: string[]): Note =>
  ({
    noteId: 1,
    modelName: "Basic",
    tags,
    cards: [11],
    fields: {
      Front: { value: "Hola", order: 0 },
      Back: { value: "Hello", order: 1 },
    },
  }) as Note;

// The run counter belongs with the arrows that change it. Asserted as shared
// parentage rather than layout, so it survives restyling but not a move back
// beside the title.
describe("CardForm sequence position", () => {
  it("groups the counter with the prev/next arrows", () => {
    render(
      <CardForm
        deckName="Spanish"
        note={note([])}
        position={{ index: 0, total: 2 }}
        onPrev={vi.fn()}
        onSkip={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const counter = screen.getByText("1 / 2");
    const nav = counter.parentElement as HTMLElement;
    expect(within(nav).getByLabelText("Previous note")).toBeTruthy();
    expect(within(nav).getByLabelText("Next note")).toBeTruthy();
  });

  it("shows no counter outside a run", () => {
    render(<CardForm deckName="Spanish" note={note([])} onClose={vi.fn()} />);

    expect(screen.queryByLabelText("Next note")).toBeNull();
  });

  // A run of one has nowhere to page to: "1 / 1" beside two dead arrows.
  it("hides both when the run holds a single note", () => {
    render(
      <CardForm
        deckName="Spanish"
        note={note([])}
        position={{ index: 0, total: 1 }}
        onPrev={vi.fn()}
        onSkip={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("1 / 1")).toBeNull();
    expect(screen.queryByLabelText("Next note")).toBeNull();
    expect(screen.queryByLabelText("Previous note")).toBeNull();
  });
});

// Without this, walking a deck's leeches is a pile of anonymous notes to edit —
// nothing on screen says why this one is in front of you.
describe("CardForm leech badge", () => {
  it("marks a note Anki has flagged as a leech", () => {
    render(<CardForm deckName="Spanish" note={note(["leech"])} onClose={vi.fn()} />);

    expect(screen.getByText("Leech")).toBeTruthy();
  });

  it("says nothing about an ordinary note", () => {
    render(<CardForm deckName="Spanish" note={note(["spanish"])} onClose={vi.fn()} />);

    expect(screen.queryByText("Leech")).toBeNull();
  });

  it("is absent when adding a note", () => {
    render(<CardForm deckName="Spanish" onClose={vi.fn()} />);

    expect(screen.queryByText("Leech")).toBeNull();
  });

  // Reads the live tag state, not the saved note: clearing the tag is how a
  // dealt-with leech is retired, so the badge has to answer to it immediately.
  it("clears as soon as the leech tag is removed", async () => {
    const user = userEvent.setup();
    render(<CardForm deckName="Spanish" note={note(["leech"])} onClose={vi.fn()} />);

    // The tag chip's remove control has no accessible name of its own, so
    // reach it through the chip carrying the tag.
    const chip = screen.getByText("leech").closest("span") as HTMLElement;
    await user.click(within(chip).getByRole("button"));

    expect(screen.queryByText("Leech")).toBeNull();
  });
});

// Suspension has no other tell in the editor: the list says it with opacity,
// which doesn't translate here.
describe("CardForm suspended badge", () => {
  it("marks a suspended note", () => {
    render(
      <CardForm deckName="Spanish" note={note([])} suspended onClose={vi.fn()} />,
    );

    expect(screen.getByText("Suspended")).toBeTruthy();
  });

  it("says nothing about a note in rotation", () => {
    render(<CardForm deckName="Spanish" note={note([])} onClose={vi.fn()} />);

    expect(screen.queryByText("Suspended")).toBeNull();
  });

  // Both can be true at once — Anki's default leech action suspends the card.
  it("sits alongside the leech badge", () => {
    render(
      <CardForm
        deckName="Spanish"
        note={note(["leech"])}
        suspended
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Leech")).toBeTruthy();
    expect(screen.getByText("Suspended")).toBeTruthy();
  });
});

// The note-level actions (as opposed to editing its text) live behind one menu,
// matching the row's kebab so the two places offer the same set.
describe("CardForm note actions", () => {
  const withActions = (props: Record<string, unknown> = {}) =>
    render(
      <CardForm
        deckName="Spanish"
        note={note([])}
        onToggleSuspend={vi.fn()}
        onForget={vi.fn(async () => true)}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />,
    );

  it("offers suspend, forget and delete", async () => {
    const user = userEvent.setup();
    withActions();

    await user.click(screen.getByLabelText("Note actions"));

    expect(screen.getByText("Suspend")).toBeTruthy();
    expect(screen.getByText("Forget")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
  });

  // The menu lives inside the editor's <form>. A trigger without an explicit
  // type defaults to submit, which saved the note and advanced the run instead
  // of opening the menu.
  it("opens the menu without submitting the form", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    withActions({ onSaved });

    await user.click(screen.getByLabelText("Note actions"));

    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText("Forget")).toBeTruthy();
  });

  it("offers to unsuspend a suspended note", async () => {
    const user = userEvent.setup();
    withActions({ suspended: true });

    await user.click(screen.getByLabelText("Note actions"));

    expect(screen.getByText("Unsuspend")).toBeTruthy();
    expect(screen.queryByText("Suspend")).toBeNull();
  });

  // Confirmed inside the popup, not in a dialog stacked over the editor.
  it("asks inside the menu, then runs the action", async () => {
    const user = userEvent.setup();
    const onForget = vi.fn();
    withActions({ onForget });

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Forget"));

    expect(screen.getByText(/Reset this note's scheduling\?/)).toBeTruthy();
    // The question replaces the list rather than opening anything new.
    expect(screen.queryByText("Suspend")).toBeNull();
    expect(onForget).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Forget" }));

    expect(onForget).toHaveBeenCalledTimes(1);
  });

  // Forget changes nothing visible in the form, so the footer has to say so.
  it("reports that the reset landed", async () => {
    const user = userEvent.setup();
    withActions();

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Forget"));
    await user.click(screen.getByRole("button", { name: "Forget" }));

    expect(screen.getByText(/Scheduling reset/)).toBeTruthy();
  });

  // Cancel returns to the list, so the menu is still usable — it doesn't
  // dismiss you back out to the form.
  // A failed reset toasts and returns false; announcing success underneath
  // that toast would contradict it.
  it("stays quiet when the reset failed", async () => {
    const user = userEvent.setup();
    withActions({ onForget: vi.fn(async () => false) });

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Forget"));
    await user.click(screen.getByRole("button", { name: "Forget" }));

    expect(screen.queryByText(/Scheduling reset/)).toBeNull();
  });

  // ModalDialog closes the whole editor on Escape, from a window listener AND
  // its panel's onKeyDown. The menu has to consume it, or backing out of a
  // question would discard the user's unsaved edits.
  it("backs out of the question without closing the editor", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    withActions({ onClose });

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Forget"));
    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Suspend")).toBeTruthy();

    // Second Escape closes the menu, still not the editor.
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("Suspend")).toBeNull();
  });

  it("backs out of the question to the list", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    withActions({ onDelete });

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Delete"));
    expect(screen.getByText(/Delete this note\?/)).toBeTruthy();

    // Scoped to the popup: the form footer has its own Cancel, which backs out
    // of the whole edit rather than just the question.
    const popup = screen.getByRole("dialog", { name: "Note actions" });
    await user.click(within(popup).getByRole("button", { name: "Cancel" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText(/Delete this note\?/)).toBeNull();
    expect(screen.getByText("Suspend")).toBeTruthy();
  });

  // The add form has no note to act on, so it gets no menu at all.
  it("shows no menu when adding a note", () => {
    render(<CardForm deckName="Spanish" onClose={vi.fn()} />);

    expect(screen.queryByLabelText("Note actions")).toBeNull();
  });

  // A caller that wires up only some of them gets only those.
  it("lists only the actions the caller wired up", async () => {
    const user = userEvent.setup();
    render(
      <CardForm
        deckName="Spanish"
        note={note([])}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText("Note actions"));

    expect(screen.getByText("Delete")).toBeTruthy();
    expect(screen.queryByText("Forget")).toBeNull();
    expect(screen.queryByText("Suspend")).toBeNull();
  });
});

// Moving is rare enough that it lives in the actions menu rather than taking
// permanent space in the form — the picker is that item's panel.
describe("CardForm move to deck", () => {
  const withMove = (onMove = vi.fn()) => {
    render(
      <CardForm
        deckName="Spanish"
        note={note([])}
        onMove={onMove}
        onClose={vi.fn()}
      />,
    );
    return onMove;
  };

  it("keeps the deck out of the form body", () => {
    withMove();

    expect(screen.queryByText("German")).toBeNull();
  });

  it("opens the deck tree inside the menu", async () => {
    const user = userEvent.setup();
    withMove();

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Move to deck…"));

    // Leaf names, not "::" paths — the tree carries the hierarchy.
    expect(screen.getByText("German")).toBeTruthy();
    expect(screen.queryByText("Spanish::Verbs")).toBeNull();
    // The panel replaces the list, like the confirmations do.
    expect(screen.queryByText("Suspend")).toBeNull();
  });

  it("moves only once a deck is chosen", async () => {
    const user = userEvent.setup();
    const onMove = withMove();

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Move to deck…"));

    const move = screen.getByRole("button", { name: "Move" });
    expect(move.hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByText("German"));
    await user.click(screen.getByRole("button", { name: "Move" }));

    expect(onMove).toHaveBeenCalledWith("German", false);
  });

  // The pick lives in the panel, so dismissing it forgets the choice — held a
  // level up, a cancelled pick came back selected with Move already armed.
  it("forgets a cancelled pick", async () => {
    const user = userEvent.setup();
    withMove();

    const open = async () => {
      await user.click(screen.getByLabelText("Note actions"));
      await user.click(screen.getByText("Move to deck…"));
    };

    await open();
    await user.click(screen.getByText("German"));
    // Scoped to the popup — the form footer has its own Cancel.
    const popup = screen.getByRole("dialog", { name: "Note actions" });
    await user.click(within(popup).getByRole("button", { name: "Cancel" }));

    await open();
    expect(
      screen.getByRole("button", { name: "Move" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  // Adds file into the deck they were opened on, so there's nothing to move.
  it("is absent when adding a note", () => {
    render(<CardForm deckName="Spanish" onClose={vi.fn()} />);

    expect(screen.queryByLabelText("Note actions")).toBeNull();
  });
});
