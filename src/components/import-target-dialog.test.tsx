// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ExportedDeck } from "@/lib/import-export";

vi.mock("@/lib/anki-fetch", () => ({
  ankiFetch: vi.fn(async (action: string) => {
    if (action === "deckNames") return ["French", "Spanish"];
    return undefined;
  }),
}));

import { ImportTargetDialog } from "./import-target-dialog";

afterEach(cleanup);

function exported(deckName: string): ExportedDeck {
  return { deckName, exportedAt: "2026-01-01T00:00:00Z", notes: [] };
}

describe("ImportTargetDialog", () => {
  it("defaults to a new deck named after the export when it doesn't exist", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ImportTargetDialog
        parsed={exported("German")}
        importing={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const newRadio = screen.getByRole("radio", { name: /New deck/ });
    expect((newRadio as HTMLInputElement).checked).toBe(true);

    // The name is editable before importing.
    const input = screen.getByPlaceholderText("Deck name");
    expect((input as HTMLInputElement).value).toBe("German");
    // A brand-new deck needs no noteId-matching explanation.
    expect(screen.queryByText(/noteId/)).toBeNull();
    await user.clear(input);
    await user.type(input, "Deutsch");
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(onConfirm).toHaveBeenCalledWith("Deutsch", true);
  });

  it("defaults to the existing source deck when it already exists", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ImportTargetDialog
        parsed={exported("Spanish")}
        importing={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const existingRadio = screen.getByRole("radio", { name: /Existing deck/ });
    await waitFor(() =>
      expect((existingRadio as HTMLInputElement).checked).toBe(true),
    );
    // Importing back into the source deck explains noteId matching.
    expect(
      screen.getByText(/matching noteIds will be updated/),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(onConfirm).toHaveBeenCalledWith("Spanish", false);
  });

  it("imports into another existing deck picked from the tree", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ImportTargetDialog
        parsed={exported("German")}
        importing={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /Existing deck/ }));
    await user.click(await screen.findByRole("button", { name: "French" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(onConfirm).toHaveBeenCalledWith("French", false);
  });
});
