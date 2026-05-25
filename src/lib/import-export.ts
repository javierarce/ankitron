import { Note } from "./types";
import { CLOZE_TYPED_MODEL } from "./cloze-typed-model";

export interface ExportedNote {
  noteId?: number;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
}

export interface ExportedDeck {
  deckName: string;
  exportedAt: string;
  notes: ExportedNote[];
}

export interface ImportResult {
  updated: number;
  added: number;
  skipped: number;
  errors: string[];
}

export interface ImportDeps {
  ankiFetch: <T>(action: string, params?: Record<string, unknown>) => Promise<T>;
  ensureClozeTypedModel: () => Promise<void>;
}

export interface ImportOptions {
  /**
   * When true, every note becomes an add regardless of whether its noteId
   * already exists in Anki. Use this for cross-deck imports — otherwise we'd
   * silently update cards in the *source* deck via their noteIds.
   */
  addOnly?: boolean;
}

export function flattenFields(fields: Note["fields"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, field] of Object.entries(fields)) {
    out[name] = field?.value ?? "";
  }
  return out;
}

export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "_").trim();
  if (!cleaned || /^_+$/.test(cleaned)) return "deck";
  return cleaned;
}

export function buildExport(
  deckName: string,
  notes: Note[],
  now: Date = new Date(),
): ExportedDeck {
  return {
    deckName,
    exportedAt: now.toISOString(),
    notes: notes.map((note) => ({
      noteId: note.noteId,
      modelName: note.modelName,
      fields: flattenFields(note.fields),
      tags: note.tags,
    })),
  };
}

export function isExportedDeck(data: unknown): data is ExportedDeck {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (typeof d.deckName !== "string") return false;
  if (!Array.isArray(d.notes)) return false;
  return d.notes.every((n) => {
    if (!n || typeof n !== "object") return false;
    const note = n as Record<string, unknown>;
    return (
      typeof note.modelName === "string" &&
      note.fields !== null &&
      typeof note.fields === "object" &&
      Array.isArray(note.tags)
    );
  });
}

async function importOne(
  deckName: string,
  note: ExportedNote,
  existingIds: Set<number>,
  result: ImportResult,
  deps: ImportDeps,
) {
  const tags = (note.tags ?? []).map((t) => String(t)).filter(Boolean);

  if (note.noteId && existingIds.has(note.noteId)) {
    try {
      await deps.ankiFetch("updateNoteFields", {
        note: { id: note.noteId, fields: note.fields },
      });
      const existing = await deps.ankiFetch<Note[]>("notesInfo", {
        notes: [note.noteId],
      });
      const currentTags = existing[0]?.tags ?? [];
      for (const tag of currentTags) {
        await deps.ankiFetch("removeTags", { notes: [note.noteId], tags: tag });
      }
      if (tags.length > 0) {
        await deps.ankiFetch("addTags", {
          notes: [note.noteId],
          tags: tags.join(" "),
        });
      }
      result.updated += 1;
    } catch (err) {
      result.errors.push(
        `Update ${note.noteId}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
    return;
  }

  try {
    if (note.modelName === CLOZE_TYPED_MODEL) {
      await deps.ensureClozeTypedModel();
    }
    const newId = await deps.ankiFetch<number | null>("addNote", {
      note: {
        deckName,
        modelName: note.modelName,
        fields: note.fields,
        tags,
        // Scope duplicate detection to the target deck only. Anki's default
        // is collection-wide, which would reject every card on a cross-deck
        // import as a duplicate of its source-deck copy.
        options: { duplicateScope: "deck" },
      },
    });
    if (newId) {
      result.added += 1;
    } else {
      result.skipped += 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "failed";
    // Anki rejects notes whose first field collides with an existing note.
    // Treat that as a skip rather than an error: it almost always means the
    // card is already in the deck (re-import, or overlap with another deck).
    if (/duplicate/i.test(msg)) {
      result.skipped += 1;
      return;
    }
    result.errors.push(`Add note: ${msg}`);
  }
}

export async function importDeck(
  deckName: string,
  parsed: ExportedDeck,
  deps: ImportDeps,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const existingIds = new Set<number>();

  if (!options.addOnly) {
    const idsInFile = parsed.notes
      .map((n) => n.noteId)
      .filter((id): id is number => typeof id === "number");

    if (idsInFile.length > 0) {
      const info = await deps.ankiFetch<Array<Note | Record<string, never>>>(
        "notesInfo",
        { notes: idsInFile },
      );
      info.forEach((entry, i) => {
        if (entry && "noteId" in entry && entry.noteId) {
          existingIds.add(idsInFile[i]);
        }
      });
    }
  }

  const result: ImportResult = { updated: 0, added: 0, skipped: 0, errors: [] };
  for (const note of parsed.notes) {
    await importOne(deckName, note, existingIds, result, deps);
  }
  return result;
}
