import { describe, it, expect } from "vitest";
import { basicFieldKeys } from "./note-fields";
import type { NoteField } from "./types";

const f = (value: string, order: number): NoteField => ({ value, order });

describe("basicFieldKeys", () => {
  it("returns front/back in field order", () => {
    expect(basicFieldKeys({ Front: f("a", 0), Back: f("b", 1) })).toEqual({
      frontKey: "Front",
      backKey: "Back",
    });
  });

  it("uses `order`, not key position (the Tauri proxy sorts keys alphabetically)", () => {
    // {Back, Front} — as the proxy delivers it — must still map Front -> front.
    expect(basicFieldKeys({ Back: f("b", 1), Front: f("a", 0) })).toEqual({
      frontKey: "Front",
      backKey: "Back",
    });
  });

  it("works for non-default field names by order", () => {
    expect(
      basicFieldKeys({ "Rückseite": f("b", 1), Vorderseite: f("a", 0) }),
    ).toEqual({ frontKey: "Vorderseite", backKey: "Rückseite" });
  });

  it("falls back to Front/Back when there are no fields", () => {
    expect(basicFieldKeys({})).toEqual({ frontKey: "Front", backKey: "Back" });
  });
});
