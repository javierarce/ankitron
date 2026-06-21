import { describe, it, expect } from "vitest";
import type { Note } from "./types";
import {
  createEditSequence,
  editSequencePrev,
  editSequenceNext,
  editSequenceSaved,
  editSequenceCurrentId,
  editSequenceCurrentNote,
  type EditSequence,
} from "./edit-sequence";

function note(noteId: number, modelName = "Basic", front = `front-${noteId}`): Note {
  return {
    noteId,
    modelName,
    fields: { Front: { value: front, order: 0 }, Back: { value: "", order: 1 } },
    tags: [],
  };
}

// A sequence sitting at a given index, for transition tests.
function at(ids: number[], index: number): EditSequence {
  return { ids, index, edited: {}, dirty: false };
}

describe("createEditSequence", () => {
  it("returns null for an empty selection", () => {
    expect(createEditSequence([])).toBeNull();
  });

  it("starts at the first card, clean, with no edits", () => {
    expect(createEditSequence([10, 20, 30])).toEqual({
      ids: [10, 20, 30],
      index: 0,
      edited: {},
      dirty: false,
    });
  });
});

describe("editSequenceNext", () => {
  it("advances within the run", () => {
    const step = editSequenceNext(at([1, 2, 3], 0));
    expect(step).toEqual({ done: false, seq: expect.objectContaining({ index: 1 }) });
  });

  it("finishes at the last card, carrying the dirty flag", () => {
    expect(editSequenceNext({ ids: [1, 2], index: 1, edited: {}, dirty: false })).toEqual({
      done: true,
      dirty: false,
    });
    expect(editSequenceNext({ ids: [1, 2], index: 1, edited: {}, dirty: true })).toEqual({
      done: true,
      dirty: true,
    });
  });
});

describe("editSequencePrev", () => {
  it("moves back one card", () => {
    expect(editSequencePrev(at([1, 2, 3], 2)).index).toBe(1);
  });

  it("clamps at the start", () => {
    expect(editSequencePrev(at([1, 2, 3], 0)).index).toBe(0);
  });

  it("keeps edits made earlier in the run", () => {
    const seq: EditSequence = {
      ids: [1, 2],
      index: 1,
      edited: { 1: note(1, "Basic", "edited") },
      dirty: true,
    };
    const back = editSequencePrev(seq);
    expect(back.edited[1].fields.Front.value).toBe("edited");
    expect(back.dirty).toBe(true);
  });
});

describe("editSequenceSaved", () => {
  it("advances without dirtying on a no-op save", () => {
    const step = editSequenceSaved(at([1, 2], 0), undefined);
    expect(step).toEqual({ done: false, seq: expect.objectContaining({ index: 1, dirty: false }) });
    if (!step.done) expect(step.seq.edited).toEqual({});
  });

  it("records the edit, marks dirty, and advances", () => {
    const updated = note(1, "Basic", "new");
    const step = editSequenceSaved(at([1, 2], 0), updated);
    expect(step.done).toBe(false);
    if (!step.done) {
      expect(step.seq.index).toBe(1);
      expect(step.seq.dirty).toBe(true);
      expect(step.seq.edited[1]).toBe(updated);
      expect(step.seq.ids).toEqual([1, 2]); // id unchanged → slot unchanged
    }
  });

  it("reports dirty on finish when the last card was changed", () => {
    const step = editSequenceSaved(at([1, 2], 1), note(2, "Basic", "new"));
    expect(step).toEqual({ done: true, dirty: true });
  });

  it("preserves dirty from an earlier card when the run finishes on a skip", () => {
    // Save card 0 (dirty), then a no-op save on the last card still finishes dirty.
    const afterFirst = editSequenceSaved(at([1, 2], 0), note(1, "Basic", "new"));
    expect(afterFirst.done).toBe(false);
    if (!afterFirst.done) {
      const finish = editSequenceSaved(afterFirst.seq, undefined);
      expect(finish).toEqual({ done: true, dirty: true });
    }
  });

  describe("type change (note gets a new id)", () => {
    it("repoints the current slot at the new id and keys the edit by it", () => {
      const retyped = note(99, "Cloze");
      const step = editSequenceSaved(at([1, 2], 0), retyped);
      expect(step.done).toBe(false);
      if (!step.done) {
        expect(step.seq.ids).toEqual([99, 2]); // slot 0 repointed 1 → 99
        expect(step.seq.edited[99]).toBe(retyped);
        expect(step.seq.edited[1]).toBeUndefined();
      }
    });

    it("paging back after a type change shows the retyped card, not the original", () => {
      // Regression test for the back-arrow-shows-wrong-type bug.
      const original = [note(1, "Basic"), note(2, "Basic")];
      const retyped = note(99, "Cloze");
      const step = editSequenceSaved(at([1, 2], 0), retyped); // edit card 0, advance to 1
      expect(step.done).toBe(false);
      if (!step.done) {
        const back = editSequencePrev(step.seq); // back to slot 0
        expect(editSequenceCurrentId(back)).toBe(99);
        expect(editSequenceCurrentNote(back, original)?.modelName).toBe("Cloze");
      }
    });

    it("survives a second type change on the back-visit", () => {
      const original = [note(1, "Basic"), note(2, "Basic")];
      let seq = at([1, 2], 0);
      const first = editSequenceSaved(seq, note(99, "Cloze")); // 1 → 99, advance
      if (first.done) throw new Error("unexpected finish");
      seq = editSequencePrev(first.seq); // back to slot 0 (now id 99)
      const second = editSequenceSaved(seq, note(123, "Basic")); // 99 → 123
      if (second.done) throw new Error("unexpected finish");
      expect(second.seq.ids).toEqual([123, 2]);
      const back = editSequencePrev(second.seq);
      expect(editSequenceCurrentNote(back, original)?.noteId).toBe(123);
    });
  });
});

describe("editSequenceCurrentNote", () => {
  const original = [note(1), note(2), note(3)];

  it("returns the original note when nothing has been edited", () => {
    expect(editSequenceCurrentNote(at([1, 2, 3], 1), original)?.noteId).toBe(2);
  });

  it("prefers the saved version over the original", () => {
    const edited = note(2, "Basic", "changed");
    const seq: EditSequence = { ids: [1, 2, 3], index: 1, edited: { 2: edited }, dirty: true };
    expect(editSequenceCurrentNote(seq, original)?.fields.Front.value).toBe("changed");
  });

  it("returns null when the card is no longer present", () => {
    expect(editSequenceCurrentNote(at([404], 0), original)).toBeNull();
  });
});
