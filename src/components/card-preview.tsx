import { useCallback, useEffect, useMemo, useState } from "react";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import type { ExportedNote } from "@/lib/import-export";
import { exportedNoteFaces } from "@/lib/card-preview";
import { HtmlContent } from "./card-html";

interface CardPreviewProps {
  notes: ExportedNote[];
  /** Deck name, shown in the canvas corner. */
  title: string;
}

/** Browse the notes of a deck about to be imported: shows one card at a time
 * with both its front and back, arrow keys or the buttons to move between
 * cards. */
export function CardPreview({ notes, title }: CardPreviewProps) {
  const [index, setIndex] = useState(0);

  const note = notes[index];
  const faces = useMemo(() => (note ? exportedNoteFaces(note) : null), [note]);

  const canNavigate = notes.length > 1;

  // Wraps around, so the last card's next is the first and the first's previous
  // is the last.
  const go = useCallback(
    (delta: number) => {
      setIndex((i) => (i + delta + notes.length) % notes.length);
    },
    [notes.length],
  );

  useEffect(() => {
    if (!canNavigate) return;
    function onKey(e: KeyboardEvent) {
      // Don't hijack arrows while the user is in a field below (typing a deck
      // name, or changing the existing-deck <select>).
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canNavigate, go]);

  if (!note || !faces) return null;

  const hasBack = faces.back.trim() !== "";

  return (
    <div>
      {/* Gray canvas the card floats on; fixed height so moving between cards
         never resizes it. Arrows reveal on hover. */}
      <div className="group relative flex h-80 items-center justify-center rounded-xl bg-foreground/5 px-12 py-8">
        <span className="absolute left-3 top-3 z-10 max-w-[60%] truncate text-sm font-medium text-foreground/50">
          {title}
        </span>
        <span className="absolute right-3 top-3 z-10 text-xs tabular-nums text-foreground/40">
          {index + 1}/{notes.length}
        </span>
        {canNavigate && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous card"
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/90 p-1.5 text-foreground/60 opacity-0 shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <CaretLeft size={18} weight="bold" />
          </button>
        )}

        <div className="flex max-h-full min-h-[7rem] w-full flex-col overflow-auto rounded-xl border border-border bg-background text-left shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <HtmlContent
            html={faces.front}
            className="prose prose-sm dark:prose-invert max-w-none px-6 py-5"
          />
          {hasBack && (
            <div className="border-t border-border bg-foreground/[0.03]">
              <HtmlContent
                html={faces.back}
                className="study-answer prose prose-sm dark:prose-invert max-w-none px-6 py-5"
              />
            </div>
          )}
        </div>

        {canNavigate && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next card"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/90 p-1.5 text-foreground/60 opacity-0 shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <CaretRight size={18} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}
