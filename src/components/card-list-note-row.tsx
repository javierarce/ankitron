// One row of the card list: checkbox, display text, tag chips, actions menu.
// Memo'd — with a big deck, a selection change would otherwise re-render every
// row; the parent keeps every callback prop identity-stable so only the rows
// whose `selected`/`suspended` flags actually flip re-render.

import {
  memo,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import type { Note } from "@/lib/types";
import { flagColor } from "@/lib/flags";
import { ActionsMenu } from "./actions-menu";
import { FlagPicker } from "./flag-picker";
import { stripCloze } from "@/lib/cloze";
import { stripHtml, truncate } from "@/lib/html-text";
import { noteDisplayFields } from "@/lib/note-fields";

// A note's two display lines for the list row, HTML-stripped and truncated.
// stripHtml costs a DOM parse per field and the list re-renders on every
// search keystroke, so the result is cached per note object (weakly — an edit
// or refetch replaces the note objects, dropping their stale entries with
// them).
const displayTextCache = new WeakMap<
  Note,
  { primary: string; secondary: string | null }
>();
function noteDisplayText(note: Note): {
  primary: string;
  secondary: string | null;
} {
  const cached = displayTextCache.get(note);
  if (cached !== undefined) return cached;
  const { primary, secondary } = noteDisplayFields(note);
  const text = {
    primary: truncate(stripCloze(stripHtml(primary)), 80),
    secondary: secondary ? truncate(stripCloze(stripHtml(secondary)), 80) : null,
  };
  displayTextCache.set(note, text);
  return text;
}

interface NoteRowProps {
  note: Note;
  selected: boolean;
  suspended: boolean;
  /** The note's flag (0 = none), shown as the coloured left border. */
  flag: number;
  draggable: boolean;
  /** Open the note in the editor. */
  onOpen: (note: Note) => void;
  onCheckboxClick: (e: ReactMouseEvent, note: Note) => void;
  onToggleSuspend: (note: Note) => void;
  /** Set the note's flag (0 clears it). */
  onSetFlag: (note: Note, flag: number) => void;
  /** Open the move-to-deck dialog for the note. */
  onMove: (note: Note) => void;
  /** Open the delete confirmation for the note. */
  onDelete: (note: Note) => void;
  onDragStart: (e: ReactDragEvent, note: Note) => void;
  onDragEnd: () => void;
}

export const NoteRow = memo(function NoteRow({
  note,
  selected,
  suspended,
  flag,
  draggable,
  onOpen,
  onCheckboxClick,
  onToggleSuspend,
  onSetFlag,
  onMove,
  onDelete,
  onDragStart,
  onDragEnd,
}: NoteRowProps) {
  return (
    <div
      data-nav-item
      data-note-id={note.noteId}
      data-selected={selected || undefined}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => onDragStart(e, note)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(note)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(note);
        }
      }}
      className={`group relative flex select-none items-center gap-3 rounded-lg border px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)] cursor-pointer transition-[background-color] ${
        selected
          ? "border-foreground/40 bg-foreground/[0.05]"
          : "border-border hover:bg-foreground/[0.02]"
      } ${suspended && !selected ? "bg-foreground/[0.03]" : ""}`}
    >
      {/* Flag indicator — a 4px rounded pill down the row's left edge, inset 4px
         from the top, bottom, and left. Sits in the px-4 gutter, clear of the
         checkbox. */}
      {flag > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-1 left-1 top-1 w-1 rounded-full"
          style={{ background: flagColor(flag) ?? undefined }}
        />
      )}
      <button
        onClick={(e) => onCheckboxClick(e, note)}
        aria-label={selected ? "Deselect note" : "Select note"}
        aria-pressed={selected}
        className="relative z-10 -m-2 flex shrink-0 items-center justify-center self-start p-2"
      >
        <span
          className={`flex h-5 w-5 translate-y-[2px] items-center justify-center rounded border transition-all ${
            selected
              ? "border-foreground bg-foreground text-background"
              : "border-foreground/25 text-transparent group-hover:border-foreground/50"
          }`}
        >
          <Check size={13} weight="bold" />
        </span>
      </button>
      <div className={`flex-1 min-w-0 ${suspended ? "opacity-50" : ""}`}>
        {(() => {
          const { primary, secondary } = noteDisplayText(note);
          return (
            <>
              <p className="text-sm font-medium">{primary}</p>
              {secondary && (
                <p className="text-sm text-foreground/50 mt-0.5">{secondary}</p>
              )}
            </>
          );
        })()}
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
        <ActionsMenu
          label="Note actions"
          items={[
            {
              label: "Edit",
              kbd: "E",
              onSelect: () => onOpen(note),
            },
            {
              label: suspended ? "Unsuspend" : "Suspend",
              kbd: "S",
              onSelect: () => onToggleSuspend(note),
            },
            {
              label: "Move to deck…",
              kbd: "M",
              onSelect: () => onMove(note),
            },
            {
              label: "Delete",
              danger: true,
              onSelect: () => onDelete(note),
            },
            {
              render: (close) => (
                <FlagPicker
                  value={flag}
                  onSelect={(f) => {
                    onSetFlag(note, f);
                    close();
                  }}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
});
