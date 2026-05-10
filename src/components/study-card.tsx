"use client";

import { useEffect } from "react";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Ease } from "@/lib/types";

interface StudyCardProps {
  question: string;
  answer: string;
  isRevealed: boolean;
  onReveal: () => void;
  onAnswer: (ease: Ease) => void;
  onEdit: () => void;
  answering: boolean;
}

export function StudyCard({
  question,
  answer,
  isRevealed,
  onReveal,
  onAnswer,
  onEdit,
  answering,
}: StudyCardProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (answering) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      if (!isRevealed) {
        if (e.key === " " || e.key === "1" || e.key === "2") {
          e.preventDefault();
          onReveal();
        }
      } else {
        if (e.key === "1") {
          e.preventDefault();
          onAnswer(1);
        }
        if (e.key === " " || e.key === "2") {
          e.preventDefault();
          onAnswer(3);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRevealed, answering, onReveal, onAnswer]);

  return (
    <div className="w-full max-w-2xl">
      <div
        onClick={!isRevealed ? onReveal : undefined}
        className={`group relative rounded-xl border border-foreground/10 p-8 shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${
          !isRevealed ? "cursor-pointer hover:bg-foreground/[0.02] transition-colors" : ""
        }`}
      >
        {isRevealed && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 rounded-md p-1.5 text-foreground/30 hover:text-foreground/60 hover:bg-foreground/5 transition-all"
            title="Edit card"
          >
            <PencilSimple size={14} weight="regular" />
          </button>
        )}

        {!isRevealed ? (
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: question }}
          />
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none [&_hr#answer]:my-6 [&_hr#answer]:border-foreground/10"
            dangerouslySetInnerHTML={{ __html: answer }}
          />
        )}
      </div>

      {isRevealed && (
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={() => onAnswer(1)}
            disabled={answering}
            className="flex min-w-[140px] items-center justify-between gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-5 py-3 text-sm font-semibold text-rose-600 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all hover:bg-rose-500/15 active:scale-[0.98] disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-400"
          >
            <span>Fail</span>
            <kbd className="flex h-5 w-5 items-center justify-center rounded border border-rose-500/30 font-sans text-xs font-semibold dark:border-rose-500/40">
              1
            </kbd>
          </button>
          <button
            onClick={() => onAnswer(3)}
            disabled={answering}
            className="flex min-w-[140px] items-center justify-between gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-semibold text-emerald-600 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-all hover:bg-emerald-500/15 active:scale-[0.98] disabled:opacity-50 dark:border-emerald-500/30 dark:text-emerald-400"
          >
            <span>Pass</span>
            <kbd className="flex h-5 w-5 items-center justify-center rounded border border-emerald-500/30 font-sans text-xs font-semibold dark:border-emerald-500/40">
              2
            </kbd>
          </button>
        </div>
      )}
    </div>
  );
}
