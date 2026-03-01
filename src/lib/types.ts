export interface AnkiRequest {
  action: string;
  version: 6;
  params?: Record<string, unknown>;
}

export interface AnkiResponse<T = unknown> {
  result: T;
  error: string | null;
}

export interface NoteField {
  value: string;
  order: number;
}

export interface Note {
  noteId: number;
  modelName: string;
  fields: Record<string, NoteField>;
  tags: string[];
  cards?: number[];
}

export interface Card {
  cardId: number;
  noteId: number;
  deckName: string;
  fields: Record<string, NoteField>;
  tags: string[];
  question: string;
  answer: string;
}

export type Ease = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
