import { describe, it, expect } from "vitest";
import {
  basicFieldKeys,
  isClozeNote,
  noteDisplayFields,
  orderedFieldNames,
} from "./note-fields";
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

describe("orderedFieldNames", () => {
  it("returns field names in Anki order, not object-key order", () => {
    // The proxy delivers keys alphabetically; `order` must decide.
    expect(
      orderedFieldNames({
        Hauptstadt: f("München", 1),
        Bundesland: f("Bayern", 0),
        Karte: f("<img>", 2),
      }),
    ).toEqual(["Bundesland", "Hauptstadt", "Karte"]);
  });

  it("returns an empty list for a note with no fields", () => {
    expect(orderedFieldNames({})).toEqual([]);
  });
});

describe("isClozeNote", () => {
  it("detects Anki's cloze model names", () => {
    expect(isClozeNote({ modelName: "Cloze", fields: {} })).toBe(true);
    expect(isClozeNote({ modelName: "Cloze (typed)", fields: {} })).toBe(true);
  });

  it("detects a Text field regardless of model name", () => {
    expect(
      isClozeNote({ modelName: "My Cloze", fields: { Text: f("x", 0) } }),
    ).toBe(true);
  });

  it("is false for a basic/custom note", () => {
    expect(
      isClozeNote({ modelName: "Basic", fields: { Front: f("a", 0) } }),
    ).toBe(false);
  });
});

describe("noteDisplayFields", () => {
  it("uses Text/Back Extra for cloze notes", () => {
    expect(
      noteDisplayFields({
        modelName: "Cloze",
        fields: { Text: f("question", 0), "Back Extra": f("extra", 1) },
      }),
    ).toEqual({ primary: "question", secondary: "extra" });
  });

  it("uses Front/Back for basic notes", () => {
    expect(
      noteDisplayFields({
        modelName: "Basic",
        fields: { Front: f("q", 0), Back: f("a", 1) },
      }),
    ).toEqual({ primary: "q", secondary: "a" });
  });

  it("falls back to the first two fields by order for custom note types", () => {
    // A shared deck (e.g. Deutsche Bundesländer) names fields its own way;
    // proxy key-sorting also reorders the object — order must still win.
    expect(
      noteDisplayFields({
        modelName: "Bundesland",
        fields: {
          Hauptstadt: f("München", 1),
          Bundesland: f("Bayern", 0),
        },
      }),
    ).toEqual({ primary: "Bayern", secondary: "München" });
  });
});
