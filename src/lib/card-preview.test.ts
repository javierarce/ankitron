import { describe, it, expect } from "vitest";
import { blankCloze, revealCloze, exportedNoteFaces } from "./card-preview";
import type { ExportedNote } from "./import-export";

const note = (
  modelName: string,
  fields: Record<string, string>,
): ExportedNote => ({ modelName, fields, tags: [] });

describe("blankCloze", () => {
  it("blanks a deletion with no hint", () => {
    expect(blankCloze("The {{c1::sky}} is blue")).toBe(
      'The <span class="cloze">[...]</span> is blue',
    );
  });

  it("uses the hint when present", () => {
    expect(blankCloze("The {{c1::sky::up}} is blue")).toBe(
      'The <span class="cloze">[up]</span> is blue',
    );
  });

  it("blanks multiple deletions", () => {
    expect(blankCloze("{{c1::a}} and {{c2::b}}")).toBe(
      '<span class="cloze">[...]</span> and <span class="cloze">[...]</span>',
    );
  });
});

describe("revealCloze", () => {
  it("reveals the answer and drops the hint", () => {
    expect(revealCloze("The {{c1::sky::up}} is blue")).toBe(
      'The <span class="cloze">sky</span> is blue',
    );
  });
});

describe("exportedNoteFaces", () => {
  it("uses Front/Back for basic notes", () => {
    expect(exportedNoteFaces(note("Basic", { Front: "q", Back: "a" }))).toEqual({
      front: "q",
      back: "a",
    });
  });

  it("prefers named Front/Back even when keys arrive alphabetically", () => {
    // Exports flatten fields in proxy (alphabetical) order, so Back precedes
    // Front in the object — name preference must still pick Front as the front.
    expect(exportedNoteFaces(note("Basic", { Back: "a", Front: "q" }))).toEqual({
      front: "q",
      back: "a",
    });
  });

  it("blanks cloze on the front and reveals it on the back", () => {
    expect(
      exportedNoteFaces(note("Cloze", { Text: "The {{c1::sky}} is blue" })),
    ).toEqual({
      front: 'The <span class="cloze">[...]</span> is blue',
      back: 'The <span class="cloze">sky</span> is blue',
    });
  });

  it("appends Back Extra to the cloze answer", () => {
    expect(
      exportedNoteFaces(
        note("Cloze", { Text: "{{c1::a}}", "Back Extra": "note" }),
      ).back,
    ).toBe('<span class="cloze">a</span><hr>note');
  });

  it("detects cloze by a Text field on a custom model", () => {
    expect(exportedNoteFaces(note("My Cloze", { Text: "{{c1::x}}" })).front).toBe(
      '<span class="cloze">[...]</span>',
    );
  });

  it("falls back to first field front, rest as back for custom note types", () => {
    expect(
      exportedNoteFaces(note("Bundesland", { Bundesland: "Bayern", Hauptstadt: "München" })),
    ).toEqual({ front: "Bayern", back: "München" });
  });

  it("strips [sound:…] placeholder tags", () => {
    expect(
      exportedNoteFaces(note("Basic", { Front: "hola [sound:hola.mp3]", Back: "hi" })).front,
    ).toBe("hola");
  });
});
