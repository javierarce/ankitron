"use client";

import { useState, useEffect } from "react";
import { CardEditor } from "./card-editor";
import { TagInput } from "./tag-input";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import { useRouter } from "next/navigation";

interface CardFormProps {
  deckName: string;
  note?: Note;
  onClose: () => void;
}

export function CardForm({ deckName, note, onClose }: CardFormProps) {
  const router = useRouter();
  const noteFields = note?.fields ?? {};
  const frontField = noteFields["Front"] ?? Object.values(noteFields)[0];
  const backField = noteFields["Back"] ?? Object.values(noteFields)[1];

  function extractValue(field: unknown): string {
    if (!field) return "";
    if (typeof field === "string") return field;
    if (typeof field === "object" && field !== null && "value" in field) {
      return String((field as { value: unknown }).value);
    }
    return "";
  }

  const [front, setFront] = useState(extractValue(frontField));
  const [back, setBack] = useState(extractValue(backField));
  const [tags, setTags] = useState<string[]>(note?.tags ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!note;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!front.trim() || !back.trim()) {
      setError("Front and back are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isEdit) {
        const fieldNames = Object.keys(note.fields ?? {});
        const frontKey = fieldNames[0] ?? "Front";
        const backKey = fieldNames[1] ?? "Back";
        await ankiFetch("updateNoteFields", {
          note: { id: note.noteId, fields: { [frontKey]: front, [backKey]: back } },
        });
        // Update tags
        for (const tag of note.tags) {
          await ankiFetch("removeTags", { notes: [note.noteId], tags: tag });
        }
        if (tags.length > 0) {
          await ankiFetch("addTags", {
            notes: [note.noteId],
            tags: tags.join(" "),
          });
        }
      } else {
        const noteId = await ankiFetch<number>("addNote", {
          note: {
            deckName,
            modelName: "Basic",
            fields: { Front: front, Back: back },
            tags,
          },
        });
        // Ensure tags are applied (some AnkiConnect versions ignore tags in addNote)
        if (tags.length > 0 && noteId) {
          await ankiFetch("addTags", {
            notes: [noteId],
            tags: tags.join(" "),
          });
        }
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save card");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="mx-4 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-foreground/10 bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold">
          {isEdit ? "Edit Card" : "Add Card"}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground/70">
              Front
            </label>
            <CardEditor content={front} onChange={setFront} placeholder="Front of card..." />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground/70">
              Back
            </label>
            <CardEditor content={back} onChange={setBack} placeholder="Back of card..." />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground/70">
              Tags
            </label>
            <TagInput tags={tags} onChange={setTags} />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm text-foreground/60 hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {saving ? "Saving..." : isEdit ? "Update Card" : "Add Card"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
