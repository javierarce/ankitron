// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ActionsMenu } from "./actions-menu";

afterEach(cleanup);

function renderMenu(overrides?: { onSelect?: () => void }) {
  const onSelect = overrides?.onSelect ?? vi.fn();
  render(
    <ActionsMenu
      label="Note actions"
      items={[
        { label: "Edit", kbd: "E", onSelect },
        { label: "Delete", danger: true, onSelect: vi.fn() },
      ]}
    />,
  );
  return onSelect;
}

describe("ActionsMenu", () => {
  it("opens the menu from the trigger", async () => {
    const user = userEvent.setup();
    renderMenu();

    const trigger = screen.getByRole("button", { name: "Note actions" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("runs the item's action and closes on click", async () => {
    const user = userEvent.setup();
    const onSelect = renderMenu();

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.click(screen.getByRole("button", { name: /Edit/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape without selecting anything", async () => {
    const user = userEvent.setup();
    const onSelect = renderMenu();

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on a mousedown outside the menu", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole("button", { name: "Note actions" }));
    expect(screen.getByRole("menu")).toBeTruthy();

    await user.pointer({ keys: "[MouseLeft>]", target: document.body });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// An item can ask before it runs, and the popup answers the question in place —
// it's used inside modals, where a confirmation dialog would be a second modal
// stacked on the first.
describe("ActionsMenu inline confirmation", () => {
  const items = (onSelect: () => void) => [
    { label: "Suspend", onSelect: vi.fn() },
    {
      label: "Delete",
      danger: true,
      confirm: { message: "Delete this? This can't be undone.", confirmLabel: "Delete" },
      onSelect,
    },
  ];

  it("swaps the list for the question instead of running", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ActionsMenu label="Note actions" items={items(onSelect)} />);

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Delete"));

    expect(screen.getByText(/Delete this\?/)).toBeTruthy();
    expect(screen.queryByText("Suspend")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("runs the item once confirmed", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ActionsMenu label="Note actions" items={items(onSelect)} />);

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Delete"));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    // …and the popup is gone.
    expect(screen.queryByText(/Delete this\?/)).toBeNull();
  });

  it("returns to the list on cancel", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ActionsMenu label="Note actions" items={items(onSelect)} />);

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Delete"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText("Suspend")).toBeTruthy();
  });

  // Escape unwinds one step at a time rather than dumping you out of both.
  it("backs out of the question before closing the menu", async () => {
    const user = userEvent.setup();
    render(<ActionsMenu label="Note actions" items={items(vi.fn())} />);

    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Delete"));

    await user.keyboard("{Escape}");
    expect(screen.getByText("Suspend")).toBeTruthy();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Suspend")).toBeNull();
  });
});

// A panel's own controls get Escape first. DeckPicker's draft field cancels a
// half-typed deck name on Escape and its filter clears a non-empty query, both
// stopping propagation — so unwinding the whole panel out from under them would
// lose work the user could see.
describe("ActionsMenu panel Escape", () => {
  const panelItem = (input: ReactNode) => [
    { label: "Suspend", onSelect: vi.fn() },
    { label: "Move to deck…", panel: () => <div>{input}</div> },
  ];

  const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByLabelText("Note actions"));
    await user.click(screen.getByText("Move to deck…"));
  };

  it("leaves the panel open when a control claims Escape", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(
      <ActionsMenu
        label="Note actions"
        items={panelItem(
          <input
            aria-label="Deck name"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                onEscape();
              }
            }}
          />,
        )}
      />,
    );

    await openPanel(user);
    await user.click(screen.getByLabelText("Deck name"));
    await user.keyboard("{Escape}");

    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Deck name")).toBeTruthy();
  });

  // The same field with nothing to unwind (an empty filter) doesn't stop it,
  // and then Escape should back out of the panel as usual.
  it("unwinds when nobody claims it", async () => {
    const user = userEvent.setup();
    render(
      <ActionsMenu
        label="Note actions"
        items={panelItem(<input aria-label="Deck name" />)}
      />,
    );

    await openPanel(user);
    await user.click(screen.getByLabelText("Deck name"));
    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText("Deck name")).toBeNull();
    expect(screen.getByText("Suspend")).toBeTruthy();
  });
});
