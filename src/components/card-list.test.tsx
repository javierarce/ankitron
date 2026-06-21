// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

// Anki is unavailable in tests; the add flow under test never calls it (the
// stubbed form below stands in for the real save), but mock it so any stray
// call resolves harmlessly instead of hitting the network.
vi.mock("@/lib/anki-fetch", () => ({ ankiFetch: vi.fn(async () => undefined) }));

// Replace the real form with a stub that exposes its callbacks as buttons, so
// the test drives the save/close contract without the editor's internals.
vi.mock("./card-form", () => ({
  CardForm: ({
    onSaved,
    onClose,
  }: {
    onSaved?: (n?: unknown) => void;
    onClose: () => void;
  }) => (
    <div>
      <button onClick={() => onSaved?.()}>stub-save</button>
      <button onClick={onClose}>stub-close</button>
    </div>
  ),
}));

import { CardList } from "./card-list";

const baseProps = {
  deckName: "Spanish",
  notes: [],
  showAddForm: true,
};

const renderInRouter = (ui: ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

afterEach(cleanup);

describe("CardList add flow", () => {
  const realLocation = window.location;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom's location.reload isn't spyable (non-configurable), so swap in a
    // stand-in location to assert whether the component reloads the page.
    reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: realLocation,
    });
  });

  it("refreshes in place and closes the form, without a page reload", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const onShowAddForm = vi.fn();

    renderInRouter(
      <CardList
        {...baseProps}
        onChanged={onChanged}
        onShowAddForm={onShowAddForm}
      />,
    );

    await user.click(screen.getByText("stub-save"));

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onShowAddForm).toHaveBeenCalledWith(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("falls back to a full reload when no in-place refresh is provided", async () => {
    const user = userEvent.setup();

    renderInRouter(<CardList {...baseProps} onShowAddForm={vi.fn()} />);

    await user.click(screen.getByText("stub-save"));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
