// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isTextEntryTarget } from "./history-nav";

function input(type: string) {
  const el = document.createElement("input");
  el.type = type;
  return el;
}

describe("isTextEntryTarget", () => {
  it("treats text-entry inputs as editable", () => {
    for (const type of ["text", "search", "email", "number", "password", "url"]) {
      expect(isTextEntryTarget(input(type)), type).toBe(true);
    }
  });

  it("treats an unrecognized input type as text (the DOM normalizes it)", () => {
    expect(isTextEntryTarget(input("something-new"))).toBe(true);
  });

  // The bulk-tag dialog's checkboxes and the import dialog's radios are the
  // real cases: Backspace there is never a deletion, so WebKit would navigate.
  it("does not treat non-text inputs as editable", () => {
    for (const type of ["checkbox", "radio", "button", "file", "range", "submit"]) {
      expect(isTextEntryTarget(input(type)), type).toBe(false);
    }
  });

  it("handles textarea, contenteditable, and plain elements", () => {
    expect(isTextEntryTarget(document.createElement("textarea"))).toBe(true);

    const editor = document.createElement("div");
    editor.contentEditable = "true";
    // jsdom doesn't derive isContentEditable from the attribute.
    Object.defineProperty(editor, "isContentEditable", { value: true });
    expect(isTextEntryTarget(editor)).toBe(true);

    expect(isTextEntryTarget(document.createElement("button"))).toBe(false);
    expect(isTextEntryTarget(document.createElement("select"))).toBe(false);
    expect(isTextEntryTarget(document.body)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(window)).toBe(false);
  });
});
