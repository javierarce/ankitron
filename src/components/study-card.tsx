"use client";

import { useEffect } from "react";
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
        className={`group relative rounded-xl border border-foreground/10 p-8 ${
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
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
            className="rounded-lg border border-red-300 px-6 py-3 text-sm font-medium text-red-500 hover:bg-red-500/5 disabled:opacity-50 transition-colors dark:border-red-500/30"
          >
            Fail <span className="ml-1 text-red-300 text-xs dark:text-red-500/50">1</span>
          </button>
          <button
            onClick={() => onAnswer(3)}
            disabled={answering}
            className="rounded-lg border border-green-300 px-6 py-3 text-sm font-medium text-green-600 hover:bg-green-500/5 disabled:opacity-50 transition-colors dark:border-green-500/30 dark:text-green-400"
          >
            Pass <span className="ml-1 text-green-300 text-xs dark:text-green-500/50">2</span>
          </button>
        </div>
      )}
    </div>
  );
}
