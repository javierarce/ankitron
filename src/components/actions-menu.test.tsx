// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
