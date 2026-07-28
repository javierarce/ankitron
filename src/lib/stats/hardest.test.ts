import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeHardestCards,
  resolveHardestNotes,
  type HardCard,
} from "./hardest";
import { REVLOG_TYPE, type RevlogEntry } from "./revlog";

const { ankiFetchMock } = vi.hoisted(() => ({ ankiFetchMock: vi.fn() }));
vi.mock("../anki-fetch", () => ({
  ankiFetch: ankiFetchMock,
  ankiMulti: vi.fn(),
}));

const now = new Date(2026, 5, 15, 12, 0, 0).getTime();

const entry = (over: Partial<RevlogEntry> & { cardId: number }): RevlogEntry => ({
  id: now,
  ease: 3,
  ivl: 30,
  lastIvl: 10,
  factor: 2500,
  timeMs: 3000,
  type: REVLOG_TYPE.review,
  deck: "Spanish",
  ...over,
});

/** `lapses` failures plus one pass for a card, ids kept unique. */
const failing = (cardId: number, lapses: number): RevlogEntry[] => [
  ...Array.from({ length: lapses }, (_, i) =>
    entry({ cardId, id: now - i * 1000, ease: 1 }),
  ),
  entry({ cardId, id: now - 99_000 - cardId }),
];

describe("computeHardestCards", () => {
  it("ranks by lapses, breaking ties on time sunk", () => {
    const entries = [
      ...failing(1, 2),
      ...failing(2, 4),
      ...failing(3, 2).map((e) => ({ ...e, timeMs: 9000 })),
    ];

    const result = computeHardestCards(entries);

    expect(result.map((c) => c.cardId)).toEqual([2, 3, 1]);
    expect(result[0].lapses).toBe(4);
  });

  // One lapse is normal forgetting, not a trouble spot.
  it("ignores cards below the lapse threshold", () => {
    const entries = [...failing(1, 1), ...failing(2, 2)];

    expect(computeHardestCards(entries).map((c) => c.cardId)).toEqual([2]);
  });

  // Failing a learning step is part of learning; relearning Agains would
  // double-charge the lapse that caused them.
  it("counts only scheduled-review failures as lapses", () => {
    const entries = [
      entry({ cardId: 1, id: now, ease: 1, type: REVLOG_TYPE.learning }),
      entry({ cardId: 1, id: now - 1, ease: 1, type: REVLOG_TYPE.relearning }),
      entry({ cardId: 1, id: now - 2, ease: 1, type: REVLOG_TYPE.cram }),
    ];

    expect(computeHardestCards(entries)).toEqual([]);
  });

  // A card that was hard years ago and solid since isn't a CURRENT problem.
  it("ignores failures before the window", () => {
    const old = failing(1, 5).map((e) => ({ ...e, id: e.id - 500 * 86_400_000 }));

    expect(computeHardestCards([...old, ...failing(2, 2)], now - 86_400_000)).toEqual([
      expect.objectContaining({ cardId: 2 }),
    ]);
  });

  it("caps the candidate list", () => {
    const entries = Array.from({ length: 40 }, (_, i) => failing(i + 1, 2)).flat();

    expect(computeHardestCards(entries).length).toBeLessThanOrEqual(24);
  });
});

describe("resolveHardestNotes", () => {
  beforeEach(() => {
    ankiFetchMock.mockReset();
  });

  const card = (cardId: number, lapses: number): HardCard => ({
    cardId,
    lapses,
    reviews: lapses + 3,
    seconds: 60,
  });

  const info = (cardId: number, noteId: number, front = "¿qué?") => ({
    cardId,
    noteId,
    deckName: "Spanish",
    question: `<div class="card">${front}</div>`,
  });

  // The exact shape real Anki returns: question HTML leading with the card
  // template's stylesheet, fields carrying the raw cloze text. The list must
  // show "Ells van de vacances.", not ".card { font-family: arial; … }".
  it("reads the front from fields, not the styled question HTML", async () => {
    ankiFetchMock.mockResolvedValue([
      {
        cardId: 10,
        noteId: 100,
        deckName: "Languages::Catalá",
        modelName: "Cloze",
        fields: {
          Text: { value: "Ells {{c1::van}} de vacances.", order: 0 },
          "Back Extra": { value: "", order: 1 },
        },
        question:
          '<style>.card { font-family: arial; } .cloze { color: blue; }</style>' +
          '<div class="card">Ells <span class="cloze">[...]</span> de vacances.[[type:cloze:Text]]</div>',
      },
    ]);

    const result = await resolveHardestNotes([card(10, 3)]);

    expect(result[0].front).toBe("Ells van de vacances.");
  });

  // Even the question-HTML fallback (fields missing) must not leak CSS.
  it("strips template style blocks when falling back to the question", async () => {
    ankiFetchMock.mockResolvedValue([
      {
        cardId: 10,
        noteId: 100,
        deckName: "Spanish",
        fields: {},
        question:
          "<style>.card { color: black; }</style><div>Confío en ti.</div>",
      },
    ]);

    const result = await resolveHardestNotes([card(10, 2)]);

    expect(result[0].front).toBe("Confío en ti.");
  });

  it("resolves cards to notes with plain-text fronts", async () => {
    ankiFetchMock.mockResolvedValue([info(10, 100, "<b>el perro</b>")]);

    const result = await resolveHardestNotes([card(10, 3)]);

    expect(result).toEqual([
      expect.objectContaining({ noteId: 100, front: "el perro", lapses: 3 }),
    ]);
  });

  // Reversed/cloze siblings are one note's problem, not two list rows.
  it("merges sibling cards of the same note", async () => {
    ankiFetchMock.mockResolvedValue([info(10, 100), info(11, 100)]);

    const result = await resolveHardestNotes([card(10, 3), card(11, 2)]);

    expect(result).toHaveLength(1);
    expect(result[0].lapses).toBe(5);
  });

  // Anki's leech action auto-suspends at 8 lapses, so the top of this
  // ranking is disproportionately cards the user has ALREADY parked — the
  // fix-list must point at active friction only.
  it("drops suspended cards", async () => {
    ankiFetchMock.mockResolvedValue([
      { ...info(10, 100, "parked leech"), queue: -1 },
      info(11, 200, "still failing"),
    ]);

    const result = await resolveHardestNotes([card(10, 9), card(11, 2)]);

    expect(result.map((n) => n.front)).toEqual(["still failing"]);
  });

  it("keeps a note whose active sibling lapses, without the suspended one's tally", async () => {
    ankiFetchMock.mockResolvedValue([
      { ...info(10, 100), queue: -1 },
      info(11, 100),
    ]);

    const result = await resolveHardestNotes([card(10, 6), card(11, 2)]);

    expect(result).toHaveLength(1);
    expect(result[0].lapses).toBe(2); // the suspended card's 6 don't count
  });

  it("drops cards whose notes no longer resolve", async () => {
    ankiFetchMock.mockResolvedValue([info(10, 100)]);

    const result = await resolveHardestNotes([card(99, 5), card(10, 2)]);

    expect(result.map((n) => n.noteId)).toEqual([100]);
  });

  it("skips the fetch entirely when there are no candidates", async () => {
    await expect(resolveHardestNotes([])).resolves.toEqual([]);
    expect(ankiFetchMock).not.toHaveBeenCalled();
  });

  it("rethrows a failed read so the caller can degrade the block", async () => {
    ankiFetchMock.mockRejectedValue(new Error("Anki is not running"));

    await expect(resolveHardestNotes([card(10, 2)])).rejects.toThrow();
  });
});
