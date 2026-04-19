"use client";

import { useState, useEffect, useRef } from "react";
import { DotsThreeVertical } from "@phosphor-icons/react";
import { Note } from "@/lib/types";
import { CardForm } from "./card-form";
import { ConfirmDialog } from "./confirm-dialog";
import { ankiFetch } from "@/lib/anki-fetch";
import { useRouter } from "next/navigation";

function decodeHtml(html: string): string {
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

function stripHtml(html: string): string {
  return decodeHtml(html.replace(/<[^>]*>/g, "")).trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\u2026";
}

function stripCloze(text: string): string {
  return text.replace(/\{\{c\d+::(.*?)\}\}/g, "$1");
}

function isClozeNote(note: Note): boolean {
  return note.modelName === "Cloze" || "Text" in note.fields;
}

function CardMenu({
  note,
  isSuspended,
  onToggleSuspend,
  onDelete,
}: {
  note: Note;
  isSuspended: boolean;
  onToggleSuspend: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1 text-foreground/30 hover:text-foreground/60 hover:bg-foreground/5 transition-all"
      >
        <DotsThreeVertical size={16} weight="bold" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 min-w-[140px] rounded-lg border border-foreground/10 bg-background py-1 shadow-lg">
          <button
            onClick={() => {
              setOpen(false);
              onToggleSuspend();
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 hover:bg-foreground/5 transition-colors"
          >
            {isSuspended ? "Unsuspend" : "Suspend"}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-red-500 hover:bg-foreground/5 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

interface CardListProps {
  deckName: string;
  notes: Note[];
  suspendedCardIds?: number[];
}

export function CardList({ deckName, notes, suspendedCardIds }: CardListProps) {
  const router = useRouter();
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deletingNote, setDeletingNote] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [suspended, setSuspended] = useState<Set<number>>(() => new Set(suspendedCardIds ?? []));

  const hasDialog = showAddForm || !!editingNote || !!deletingNote;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (hasDialog) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "a") {
        e.preventDefault();
        setShowAddForm(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasDialog]);

  function isNoteSuspended(note: Note): boolean {
    return (note.cards ?? []).some((id) => suspended.has(id));
  }

  async function handleToggleSuspend(note: Note) {
    const cardIds = note.cards ?? [];
    if (cardIds.length === 0) return;
    const isSuspended = isNoteSuspended(note);
    try {
      await ankiFetch(isSuspended ? "unsuspend" : "suspend", { cards: cardIds });
      setSuspended((prev) => {
        const next = new Set(prev);
        for (const id of cardIds) {
          if (isSuspended) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    } catch {
      // silently fail
    }
  }

  async function handleDelete() {
    if (!deletingNote) return;
    setDeleting(true);
    try {
      await ankiFetch("deleteNotes", { notes: [deletingNote.noteId] });
      setDeletingNote(null);
      router.refresh();
    } catch {
      setDeletingNote(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-foreground/50">
          {notes.length} {notes.length === 1 ? "card" : "cards"}
        </p>
        <button
          onClick={() => setShowAddForm(true)}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Add Card
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="text-foreground/50">
          No cards yet. Add your first card above.
        </p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => {
            const noteSuspended = isNoteSuspended(note);
            return (
              <div
                key={note.noteId}
                className={`group relative flex items-start gap-4 rounded-lg border border-foreground/10 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${
                  noteSuspended ? "bg-foreground/[0.03]" : ""
                }`}
              >
                <div className={`flex-1 min-w-0 ${noteSuspended ? "opacity-50" : ""}`}>
                  {isClozeNote(note) ? (
                    <>
                      <p className="text-sm font-medium">
                        {truncate(stripCloze(stripHtml(note.fields.Text?.value ?? "")), 80)}
                      </p>
                      {note.fields["Back Extra"]?.value && (
                        <p className="text-sm text-foreground/50 mt-0.5">
                          {truncate(stripHtml(note.fields["Back Extra"].value), 80)}
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">
                        {truncate(stripHtml(note.fields.Front?.value ?? ""), 80)}
                      </p>
                      <p className="text-sm text-foreground/50 mt-0.5">
                        {truncate(stripHtml(note.fields.Back?.value ?? ""), 80)}
                      </p>
                    </>
                  )}
                  {note.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {note.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs text-foreground/60"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setEditingNote(note)}
                    className="rounded-md p-1 text-foreground/30 hover:text-foreground/60 hover:bg-foreground/5 transition-all"
                    title="Edit card"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      <path d="m15 5 4 4" />
                    </svg>
                  </button>
                  <CardMenu
                    note={note}
                    isSuspended={noteSuspended}
                    onToggleSuspend={() => handleToggleSuspend(note)}
                    onDelete={() => setDeletingNote(note)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddForm && (
        <CardForm deckName={deckName} onClose={() => setShowAddForm(false)} />
      )}

      {editingNote && (
        <CardForm
          deckName={deckName}
          note={editingNote}
          onClose={() => setEditingNote(null)}
        />
      )}

      {deletingNote && (
        <ConfirmDialog
          title="Delete Card"
          message={`Delete "${truncate(
            isClozeNote(deletingNote)
              ? stripCloze(stripHtml(deletingNote.fields.Text?.value ?? ""))
              : stripHtml(deletingNote.fields.Front?.value ?? ""),
            50
          )}"?`}
          onConfirm={handleDelete}
          onCancel={() => setDeletingNote(null)}
          loading={deleting}
        />
      )}
    </div>
  );
}
