import { AnkiResponse, Note, Card } from "./types";

const ANKI_URL = "http://localhost:8765";

export class AnkiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnkiError";
  }
}

export async function ankiRequest<T = unknown>(
  action: string,
  params?: Record<string, unknown>
): Promise<T> {
  const body = JSON.stringify({ action, version: 6, params });

  const response = await fetch(ANKI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    throw new AnkiError(`AnkiConnect returned ${response.status}`);
  }

  const data: AnkiResponse<T> = await response.json();

  if (data.error) {
    throw new AnkiError(data.error);
  }

  return data.result;
}

export async function checkConnection(): Promise<boolean> {
  try {
    const version = await ankiRequest<number>("version");
    return version >= 6;
  } catch {
    return false;
  }
}

export async function getDecks(): Promise<string[]> {
  return ankiRequest<string[]>("deckNames");
}

export async function createDeck(name: string): Promise<number> {
  return ankiRequest<number>("createDeck", { deck: name });
}

export async function deleteDeck(name: string): Promise<void> {
  await ankiRequest("deleteDecks", { decks: [name], cardsToo: true });
}

export async function getNotesInDeck(deckName: string): Promise<Note[]> {
  const noteIds = await ankiRequest<number[]>("findNotes", {
    query: `deck:"${deckName}"`,
  });

  if (noteIds.length === 0) return [];

  return ankiRequest<Note[]>("notesInfo", { notes: noteIds });
}

export async function addNote(
  deckName: string,
  front: string,
  back: string,
  tags: string[]
): Promise<number> {
  return ankiRequest<number>("addNote", {
    note: {
      deckName,
      modelName: "Basic",
      fields: { Front: front, Back: back },
      tags,
    },
  });
}

export async function updateNote(
  noteId: number,
  front: string,
  back: string,
  tags: string[]
): Promise<void> {
  await ankiRequest("updateNoteFields", {
    note: {
      id: noteId,
      fields: { Front: front, Back: back },
    },
  });
  // Update tags: clear existing, then add new ones
  const existingNote = await ankiRequest<Note[]>("notesInfo", {
    notes: [noteId],
  });
  if (existingNote.length > 0) {
    for (const tag of existingNote[0].tags) {
      await ankiRequest("removeTags", { notes: [noteId], tags: tag });
    }
    if (tags.length > 0) {
      await ankiRequest("addTags", { notes: [noteId], tags: tags.join(" ") });
    }
  }
}

export async function deleteNotes(noteIds: number[]): Promise<void> {
  await ankiRequest("deleteNotes", { notes: noteIds });
}

// Study mode helpers

export async function guiDeckReview(deckName: string): Promise<boolean> {
  try {
    await ankiRequest("guiDeckReview", { name: deckName });
    return true;
  } catch {
    return false;
  }
}

export async function guiCurrentCard(): Promise<Card | null> {
  try {
    const result = await ankiRequest<Card>("guiCurrentCard");
    return result;
  } catch {
    return null;
  }
}

export async function guiStartCardTimer(): Promise<boolean> {
  try {
    await ankiRequest("guiStartCardTimer");
    return true;
  } catch {
    return false;
  }
}

export async function guiShowAnswer(): Promise<boolean> {
  try {
    await ankiRequest("guiShowAnswer");
    return true;
  } catch {
    return false;
  }
}

export async function guiAnswerCard(ease: 1 | 2 | 3 | 4): Promise<boolean> {
  try {
    await ankiRequest("guiAnswerCard", { ease });
    return true;
  } catch {
    return false;
  }
}

export async function getDueCount(
  deckName: string
): Promise<{ new: number; learn: number; review: number }> {
  try {
    const stats = await ankiRequest<
      Record<string, { new_count: number; learn_count: number; review_count: number }>
    >("getDeckStats", { decks: [deckName] });
    const deckStats = Object.values(stats)[0];
    return {
      new: deckStats?.new_count ?? 0,
      learn: deckStats?.learn_count ?? 0,
      review: deckStats?.review_count ?? 0,
    };
  } catch {
    return { new: 0, learn: 0, review: 0 };
  }
}
