// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModalDialog } from "./modal-dialog";
import { isScrollLocked } from "@/hooks/use-scroll-lock";

afterEach(cleanup);

function backdropOf(dialog: HTMLElement): HTMLElement {
  return dialog.parentElement as HTMLElement;
}

describe("ModalDialog", () => {
  it("renders a labelled dialog into document.body and locks scroll", () => {
    const { unmount } = render(
      <ModalDialog title="Rename Deck" onClose={vi.fn()}>
        <p>content</p>
      </ModalDialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Rename Deck" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Portaled to the body root, not the render container.
    expect(backdropOf(dialog).parentElement).toBe(document.body);
    expect(isScrollLocked()).toBe(true);
    unmount();
    expect(isScrollLocked()).toBe(false);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <ModalDialog title="T" onClose={onClose}>
        <p>content</p>
      </ModalDialog>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape pressed inside the panel", () => {
    const onClose = vi.fn();
    render(
      <ModalDialog title="T" onClose={onClose}>
        <input placeholder="field" />
      </ModalDialog>,
    );

    fireEvent.keyDown(screen.getByPlaceholderText("field"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop mousedown but not on a panel mousedown", () => {
    const onClose = vi.fn();
    render(
      <ModalDialog title="T" onClose={onClose}>
        <p>content</p>
      </ModalDialog>,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(backdropOf(dialog));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks Escape and backdrop dismiss while busy, and disables the footer", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ModalDialog
        title="T"
        busy
        onClose={onClose}
        footer={{ confirmLabel: "Move", busyLabel: "Moving…", onConfirm }}
      >
        <p>content</p>
      </ModalDialog>,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(backdropOf(dialog));
    expect(onClose).not.toHaveBeenCalled();

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Moving…" });
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it("ignores Escape and backdrop while a stacked dialog owns dismissal", () => {
    const onClose = vi.fn();
    render(
      <ModalDialog title="T" blocked onClose={onClose}>
        <p>content</p>
      </ModalDialog>,
    );

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.mouseDown(backdropOf(dialog));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("lets keys bubble past the dialog only when blocked", () => {
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    const { rerender } = render(
      <ModalDialog title="T" onClose={vi.fn()}>
        <input placeholder="field" />
      </ModalDialog>,
    );

    // Contained: keys typed in the dialog never reach window listeners.
    fireEvent.keyDown(screen.getByPlaceholderText("field"), { key: "a" });
    expect(outer).not.toHaveBeenCalled();

    // Blocked: a stacked dialog's window-level handlers must still see keys.
    rerender(
      <ModalDialog title="T" blocked onClose={vi.fn()}>
        <input placeholder="field" />
      </ModalDialog>,
    );
    fireEvent.keyDown(screen.getByPlaceholderText("field"), { key: "a" });
    expect(outer).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", outer);
  });

  it("wires the convenience footer to onConfirm and onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ModalDialog
        title="T"
        onClose={onClose}
        footer={{ confirmLabel: "Apply", onConfirm }}
      >
        <p>content</p>
      </ModalDialog>,
    );

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables only the confirm button via confirmDisabled", () => {
    render(
      <ModalDialog
        title="T"
        onClose={vi.fn()}
        footer={{ confirmLabel: "Move", confirmDisabled: true, onConfirm: vi.fn() }}
      >
        <p>content</p>
      </ModalDialog>,
    );

    const move = screen.getByRole("button", { name: "Move" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect((move as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(false);
  });

  it("renders a custom footer node verbatim", () => {
    render(
      <ModalDialog
        title="T"
        onClose={vi.fn()}
        footer={<button type="button">Overwrite anyway</button>}
      >
        <p>content</p>
      </ModalDialog>,
    );

    expect(
      screen.getByRole("button", { name: "Overwrite anyway" }),
    ).toBeTruthy();
  });

  it("falls back to aria-label when no title is rendered", () => {
    render(
      <ModalDialog ariaLabel="Edit Note" onClose={vi.fn()}>
        <p>content</p>
      </ModalDialog>,
    );

    expect(screen.getByRole("dialog", { name: "Edit Note" })).toBeTruthy();
  });
});
