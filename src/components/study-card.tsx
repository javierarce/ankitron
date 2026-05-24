"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Ease } from "@/lib/types";
import {
  diffTypedAnswer,
  extractExpectedClozeAnswer,
  groupRuns,
} from "@/lib/typed-answer-diff";

interface StudyCardProps {
  question: string;
  answer: string;
  isRevealed: boolean;
  onReveal: () => void;
  onAnswer: (ease: Ease) => void;
  onEdit: () => void;
  answering: boolean;
}

const TYPE_CLOZE_RE = /\[\[type:cloze:[^\]]+\]\]/g;

function hasTypeCloze(html: string): boolean {
  return /\[\[type:cloze:[^\]]+\]\]/.test(html);
}

function stripTypeCloze(html: string): string {
  return html.replace(TYPE_CLOZE_RE, "");
}

function splitOnTypeCloze(html: string): [string, string] {
  const match = html.match(/\[\[type:cloze:[^\]]+\]\]/);
  if (!match || match.index === undefined) return [html, ""];
  return [html.slice(0, match.index), html.slice(match.index + match[0].length)];
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
  const typed = useMemo(() => hasTypeCloze(question), [question]);
  const [typedValue, setTypedValue] = useState("");
  const [submittedValue, setSubmittedValue] = useState("");
  const [prevQuestion, setPrevQuestion] = useState(question);
  const inputRef = useRef<HTMLInputElement>(null);

  if (prevQuestion !== question) {
    setPrevQuestion(question);
    setTypedValue("");
    setSubmittedValue("");
  }

  useEffect(() => {
    if (typed && !isRevealed) {
      inputRef.current?.focus();
    }
  }, [typed, isRevealed, question]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (answering) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;

      if (!isRevealed) {
        if (inEditable) return;
        if (e.key === " " || e.key === "1" || e.key === "2") {
          e.preventDefault();
          onReveal();
        }
      } else {
        // Allow grading keys even if the (now-disabled) input was last focused.
        if (inEditable && tag !== "INPUT") return;
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

  function handleSubmitTyped() {
    setSubmittedValue(typedValue);
    inputRef.current?.blur();
    onReveal();
  }

  const [questionBefore, questionAfter] = useMemo(
    () => (typed ? splitOnTypeCloze(question) : [question, ""]),
    [typed, question]
  );

  const cleanedAnswer = useMemo(
    () => (typed ? stripTypeCloze(answer) : answer),
    [typed, answer]
  );

  const expectedAnswer = useMemo(
    () => (typed ? extractExpectedClozeAnswer(question, answer) : ""),
    [typed, question, answer]
  );

  const typedDiff = useMemo(() => {
    if (!typed || !submittedValue.trim() || !expectedAnswer) return null;
    return diffTypedAnswer(submittedValue.trim(), expectedAnswer);
  }, [typed, submittedValue, expectedAnswer]);

  return (
    <div className="w-full max-w-2xl">
      <div
        onClick={!isRevealed && !typed ? onReveal : undefined}
        className={`group relative rounded-xl border border-foreground/10 px-8 pt-9 pb-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${
          !isRevealed && !typed ? "cursor-pointer hover:bg-foreground/[0.02] transition-colors" : ""
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
          typed ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <div dangerouslySetInnerHTML={{ __html: questionBefore }} />
              <input
                ref={inputRef}
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmitTyped();
                  }
                }}
                placeholder="Type your answer…"
                className="my-2 w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
              />
              <div dangerouslySetInnerHTML={{ __html: questionAfter }} />
            </div>
          ) : (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: question }}
            />
          )
        ) : (
          <div className="study-answer prose prose-sm dark:prose-invert max-w-none">
            {typed && (
              <>
                {typedDiff ? (
                  typedDiff.correct ? (
                    <div className="flex justify-center">
                      <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 font-mono text-sm text-emerald-600 dark:border-emerald-500/30 dark:text-emerald-400">
                        {submittedValue.trim()}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-center gap-3 font-mono text-sm">
                      <span className="inline-flex overflow-hidden rounded-md border border-foreground/10">
                        {groupRuns(typedDiff.typed).map((r, idx) => (
                          <span
                            key={idx}
                            className={
                              "px-1.5 py-1 " +
                              (r.match
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-rose-500/10 text-rose-600 dark:text-rose-400")
                            }
                          >
                            {r.text}
                          </span>
                        ))}
                      </span>
                      <span className="text-foreground/30" aria-hidden>→</span>
                      <span className="inline-flex overflow-hidden rounded-md border border-foreground/10">
                        {groupRuns(typedDiff.expected).map((r, idx) => (
                          <span
                            key={idx}
                            className={
                              "px-1.5 py-1 " +
                              (r.match
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-foreground/5 text-foreground/40")
                            }
                          >
                            {r.text}
                          </span>
                        ))}
                      </span>
                    </div>
                  )
                ) : (
                  <div className="text-sm">
                    <span className="text-foreground/40">You typed: </span>
                    <span className="text-foreground/70">{submittedValue || <em className="text-foreground/30">(nothing)</em>}</span>
                  </div>
                )}
                <hr />
              </>
            )}
            <div dangerouslySetInnerHTML={{ __html: cleanedAnswer }} />
          </div>
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
