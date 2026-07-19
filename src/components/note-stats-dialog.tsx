import { useEffect, useRef, useState } from "react";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { ModalDialog } from "./modal-dialog";
import { NoteStatsPanel } from "./note-stats-panel";
import { stripCloze } from "@/lib/cloze";
import { stripHtml, truncate } from "@/lib/html-text";
import { noteDisplayFields } from "@/lib/note-fields";
import type { Note } from "@/lib/types";

interface NoteStatsDialogProps {
  /** The notes the dialog can page through (e.g. the filtered list). */
  notes: Note[];
  /** Which note is shown. */
  index: number;
  /** Move to another note in `notes`. */
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/**
 * A standalone statistics view for a note — its own dialog, no longer a mode of
 * the edit form. Shows the note's question up top so you can recognise which
 * note you're looking at, and (when opened over a list) pages through the rest
 * with the header arrows or Left/Right.
 */
export function NoteStatsDialog({
  notes,
  index,
  onIndexChange,
  onClose,
}: NoteStatsDialogProps) {
  // Carry the panel's height across the per-note remount so paging animates
  // from the previous height instead of collapsing to the spinner.
  const [height, setHeight] = useState<number | undefined>(undefined);
  const keyWrapRef = useRef<HTMLDivElement>(null);

  const note = notes[index];

  // Keep focus on the key handler so Left/Right work — including after a click
  // on the header arrows moves focus away.
  useEffect(() => {
    keyWrapRef.current?.focus({ preventScroll: true });
  }, [index]);

  if (!note) return null;

  const hasNav = notes.length > 1;
  const goPrev = () => index > 0 && onIndexChange(index - 1);
  const goNext = () => index < notes.length - 1 && onIndexChange(index + 1);

  // ModalDialog stops key propagation, so navigation keys are handled here,
  // inside the dialog, on a focusable wrapper.
  function handleKeys(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    }
  }

  // Just the front, so you can recognise the note without the answer spoiling it.
  const { primary } = noteDisplayFields(note);
  const primaryText = truncate(stripCloze(stripHtml(primary)), 120);

  return (
    <ModalDialog ariaLabel="Note statistics" width="2xl" scrollable onClose={onClose}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-foreground/40">
            Statistics
          </div>
          <div className="mt-1 truncate text-base font-medium">
            {primaryText || <span className="text-foreground/40">(empty)</span>}
          </div>
        </div>
        {hasNav && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 text-sm tabular-nums text-foreground/40">
              {index + 1} / {notes.length}
            </span>
            <button
              type="button"
              onClick={goPrev}
              disabled={index === 0}
              aria-label="Previous note"
              className="rounded-md p-1.5 text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <CaretLeft size={18} weight="bold" />
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={index === notes.length - 1}
              aria-label="Next note"
              className="rounded-md p-1.5 text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <CaretRight size={18} weight="bold" />
            </button>
          </div>
        )}
      </div>

      <div ref={keyWrapRef} tabIndex={-1} onKeyDown={handleKeys} className="focus:outline-none">
        <NoteStatsPanel
          key={note.noteId}
          note={note}
          initialHeight={height}
          onHeightChange={setHeight}
        />
      </div>
    </ModalDialog>
  );
}
