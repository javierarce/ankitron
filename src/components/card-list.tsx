import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Checks } from "@phosphor-icons/react/dist/ssr/Checks";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { Pause } from "@phosphor-icons/react/dist/ssr/Pause";
import { Play } from "@phosphor-icons/react/dist/ssr/Play";
import { FolderSimple } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { Note } from "@/lib/types";
import { CardForm } from "./card-form";
import { ConfirmDialog } from "./confirm-dialog";
import { MoveCardDialog } from "./move-card-dialog";
import { ankiFetch } from "@/lib/anki-fetch";
import { stripSoundTags } from "@/lib/audio";
import { useVimNav } from "@/hooks/use-vim-nav";

function decodeHtml(html: string): string {
  if (typeof document === "undefined") {
    return html
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
}

function stripHtml(html: string): string {
  return decodeHtml(stripSoundTags(html).replace(/<[^>]*>/g, "")).trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\u2026";
}

function stripCloze(text: string): string {
  return text.replace(/\{\{c\d+::(.*?)\}\}/g, (_, inner: string) => {
    const hintIdx = inner.lastIndexOf("::");
    return hintIdx === -1 ? inner : inner.slice(0, hintIdx);
  });
}

function isClozeNote(note: Note): boolean {
  return (
    note.modelName === "Cloze" ||
    note.modelName === "Cloze (typed)" ||
    "Text" in note.fields
  );
}

function CardMenu({
  isSuspended,
  onToggleSuspend,
  onMove,
  onDelete,
}: {
  isSuspended: boolean;
  onToggleSuspend: () => void;
  onMove: () => void;
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
        aria-label="Card actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="shrink-0 rounded-md p-1 text-foreground/30 transition-all hover:bg-foreground/5 hover:text-foreground/60"
      >
        <DotsThreeVertical size={22} weight="bold" />
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
              onMove();
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 hover:bg-foreground/5 transition-colors"
          >
            Move to deck&hellip;
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
  /** Called after cards are suspended or unsuspended, so the parent can refresh due counts. */
  onSuspendChange?: () => void;
}

export function CardList({ deckName, notes, suspendedCardIds, onSuspendChange }: CardListProps) {
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deletingNote, setDeletingNote] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [movingNote, setMovingNote] = useState<Note | null>(null);
  const [suspended, setSuspended] = useState<Set<number>>(() => new Set(suspendedCardIds ?? []));
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const lastSelectedRef = useRef<number | null>(null);
  const hoveredIdRef = useRef<number | null>(null);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const hasDialog =
    showAddForm || !!editingNote || !!deletingNote || !!movingNote || bulkMoving || bulkDeleteOpen;

  useVimNav({ back: "/", enabled: !hasDialog });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (hasDialog) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === "/" && !inField) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (inField) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "a" || e.key === "A")) {
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>("[data-note-id]")
        );
        if (rows.length > 0) {
          e.preventDefault();
          setSelectedIds(new Set(rows.map((el) => Number(el.dataset.noteId))));
        }
        return;
      }
      if (e.key === "Escape" && selectedIds.size > 0) {
        e.preventDefault();
        setSelectedIds(new Set());
        return;
      }
      if (e.key === " " || e.code === "Space") {
        const activeId = (target?.closest("[data-note-id]") as HTMLElement | null)
          ?.dataset.noteId;
        const id = activeId != null ? Number(activeId) : hoveredIdRef.current;
        if (id != null) {
          e.preventDefault();
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
          lastSelectedRef.current = id;
        }
        return;
      }
      if (e.key === "a" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShowAddForm(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasDialog, selectedIds]);

  const trimmedQuery = query.trim().toLowerCase();
  const filteredNotes = trimmedQuery
    ? notes.filter((note) => {
        const haystack = [
          note.fields.Front?.value,
          note.fields.Back?.value,
          note.fields.Text?.value,
          note.fields["Back Extra"]?.value,
        ]
          .filter(Boolean)
          .map((v) => stripCloze(stripHtml(v as string)))
          .concat(note.tags)
          .join(" ")
          .toLowerCase();
        return haystack.includes(trimmedQuery);
      })
    : notes;

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
      onSuspendChange?.();
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
      window.location.reload();
    } catch {
      setDeletingNote(null);
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelected(noteId: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }

  function handleCheckboxClick(e: ReactMouseEvent, note: Note) {
    e.stopPropagation();
    const anchorId = lastSelectedRef.current;
    if (e.shiftKey && anchorId !== null) {
      const anchorIdx = filteredNotes.findIndex((n) => n.noteId === anchorId);
      const clickedIdx = filteredNotes.findIndex((n) => n.noteId === note.noteId);
      if (anchorIdx !== -1 && clickedIdx !== -1) {
        const [start, end] =
          anchorIdx < clickedIdx ? [anchorIdx, clickedIdx] : [clickedIdx, anchorIdx];
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (let i = start; i <= end; i++) next.add(filteredNotes[i].noteId);
          return next;
        });
        lastSelectedRef.current = note.noteId;
        return;
      }
    }
    toggleSelected(note.noteId);
    lastSelectedRef.current = note.noteId;
  }

  function clearSelection() {
    setSelectedIds(new Set());
    lastSelectedRef.current = null;
  }

  const selectedNotes = notes.filter((n) => selectedIds.has(n.noteId));
  const selectionActive = selectedNotes.length > 0;
  const allSelectedSuspended =
    selectionActive && selectedNotes.every((n) => isNoteSuspended(n));

  const allVisibleSelected =
    filteredNotes.length > 0 &&
    filteredNotes.every((note) => selectedIds.has(note.noteId));

  function selectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const note of filteredNotes) next.add(note.noteId);
      return next;
    });
  }

  async function handleBulkSuspend(suspend: boolean) {
    const cardIds = selectedNotes.flatMap((n) => n.cards ?? []);
    if (cardIds.length === 0) return;
    try {
      await ankiFetch(suspend ? "suspend" : "unsuspend", { cards: cardIds });
      setSuspended((prev) => {
        const next = new Set(prev);
        for (const id of cardIds) {
          if (suspend) next.add(id);
          else next.delete(id);
        }
        return next;
      });
      onSuspendChange?.();
    } catch {
      // silently fail
    }
  }

  async function handleBulkDelete() {
    if (selectedNotes.length === 0) return;
    setBulkDeleting(true);
    try {
      await ankiFetch("deleteNotes", {
        notes: selectedNotes.map((n) => n.noteId),
      });
      setBulkDeleteOpen(false);
      window.location.reload();
    } catch {
      setBulkDeleteOpen(false);
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) {
                setQuery("");
              } else {
                searchRef.current?.blur();
              }
            }
          }}
          placeholder="Search cards…"
          className="flex-1 rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:outline-none focus:border-foreground/30"
        />
        <button
          onClick={() => setShowAddForm(true)}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          Add Card
        </button>
      </div>

      <div className="mb-4 flex h-9 items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {selectionActive ? (
            <>
              <p className="text-sm font-medium">
                {selectedNotes.length}{" "}
                {selectedNotes.length === 1 ? "card" : "cards"} selected
              </p>
              {!allVisibleSelected && (
                <button
                  onClick={selectAllVisible}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-foreground/50 hover:text-foreground transition-colors"
                >
                  <Checks size={15} weight="bold" />
                  Select all
                </button>
              )}
              <button
                onClick={clearSelection}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-foreground/50 hover:text-foreground transition-colors"
              >
                <X size={14} weight="bold" />
                Clear
              </button>
            </>
          ) : (
            <p className="text-sm text-foreground/50">
              {trimmedQuery
                ? `${filteredNotes.length} of ${notes.length} ${notes.length === 1 ? "card" : "cards"}`
                : `${notes.length} ${notes.length === 1 ? "card" : "cards"}`}
            </p>
          )}
        </div>
        {selectionActive && (
          <div className="flex items-center gap-2">
              <button
                onClick={() => handleBulkSuspend(!allSelectedSuspended)}
                className="flex items-center gap-1.5 rounded-lg border border-foreground/15 px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
              >
                {allSelectedSuspended ? (
                  <>
                    <Play size={16} weight="bold" />
                    Unsuspend
                  </>
                ) : (
                  <>
                    <Pause size={16} weight="bold" />
                    Suspend
                  </>
                )}
              </button>
              <button
                onClick={() => setBulkMoving(true)}
                className="flex items-center gap-1.5 rounded-lg border border-foreground/15 px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
              >
                <FolderSimple size={16} weight="bold" />
                Move
              </button>
              <button
                onClick={() => setBulkDeleteOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash size={16} weight="bold" />
                Delete
              </button>
          </div>
        )}
      </div>

      {notes.length === 0 ? (
        <p className="text-foreground/50">
          No cards yet. Add your first card above.
        </p>
      ) : filteredNotes.length === 0 ? (
        <p className="text-foreground/50">No cards match &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className="space-y-2">
          {filteredNotes.map((note) => {
            const noteSuspended = isNoteSuspended(note);
            const selected = selectedIds.has(note.noteId);
            return (
              <div
                key={note.noteId}
                data-nav-item
                data-note-id={note.noteId}
                data-selected={selected || undefined}
                role="button"
                tabIndex={0}
                onClick={() => setEditingNote(note)}
                onMouseEnter={() => {
                  hoveredIdRef.current = note.noteId;
                }}
                onMouseLeave={() => {
                  if (hoveredIdRef.current === note.noteId) {
                    hoveredIdRef.current = null;
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setEditingNote(note);
                  }
                }}
                className={`group relative flex select-none items-center gap-3 rounded-lg border px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)] cursor-pointer transition-colors ${
                  selected
                    ? "border-foreground/40 bg-foreground/[0.05]"
                    : "border-foreground/10 hover:bg-foreground/[0.02]"
                } ${noteSuspended && !selected ? "bg-foreground/[0.03]" : ""}`}
              >
                <button
                  onClick={(e) => handleCheckboxClick(e, note)}
                  aria-label={selected ? "Deselect card" : "Select card"}
                  aria-pressed={selected}
                  className="relative z-10 -m-2 flex shrink-0 items-center justify-center p-2"
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded border transition-all ${
                      selected
                        ? "border-foreground bg-foreground text-background"
                        : "border-foreground/25 text-transparent group-hover:border-foreground/50"
                    }`}
                  >
                    <Check size={13} weight="bold" />
                  </span>
                </button>
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
                <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <CardMenu
                    isSuspended={noteSuspended}
                    onToggleSuspend={() => handleToggleSuspend(note)}
                    onMove={() => setMovingNote(note)}
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

      {movingNote && (
        <MoveCardDialog
          notes={[movingNote]}
          currentDeck={deckName}
          onClose={() => setMovingNote(null)}
        />
      )}

      {bulkMoving && (
        <MoveCardDialog
          notes={selectedNotes}
          currentDeck={deckName}
          onClose={() => setBulkMoving(false)}
        />
      )}

      {bulkDeleteOpen && (
        <ConfirmDialog
          title={
            selectedNotes.length === 1 ? "Delete Card" : "Delete Cards"
          }
          message={
            selectedNotes.length === 1
              ? "Delete the selected card?"
              : `Delete ${selectedNotes.length} selected cards?`
          }
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleteOpen(false)}
          loading={bulkDeleting}
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
