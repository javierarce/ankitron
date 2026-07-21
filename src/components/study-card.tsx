import { useEffect, useMemo, useRef, useState } from "react";
import { Ease } from "@/lib/types";
import {
  onPlayingFileChange,
  playAudio,
  resolveCardAudio,
  stopAudio,
} from "@/lib/audio";
import {
  diffTypedAnswer,
  extractExpectedClozeAnswer,
  groupRuns,
} from "@/lib/typed-answer-diff";
import { isScrollLocked } from "@/hooks/use-scroll-lock";
import { flagColor, flagTint } from "@/lib/flags";
import { ActionsMenu } from "./actions-menu";
import { FlagPicker } from "./flag-picker";
import { HtmlContent } from "./card-html";

interface StudyCardProps {
  question: string;
  answer: string;
  isRevealed: boolean;
  onReveal: () => void;
  onAnswer: (ease: Ease) => void;
  onEdit: () => void;
  onSuspend: () => void;
  answering: boolean;
  /** Ordered [sound:…] filenames from the note's raw fields. */
  sounds: string[];
  /** The card's current flag (0 = none), shown as the top colour bar. */
  flag?: number;
  /** Apply a flag to the card (0 clears it). */
  onSetFlag?: (flag: number) => void;
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

// The typed-cloze front template ends the cloze line with a <br> before the
// input (see FRONT_TEMPLATE). On reveal there's no input, so that trailing
// break would leave a dangling empty line — strip trailing breaks/whitespace.
function trimTrailingBreaks(html: string): string {
  return html.replace(/(?:\s|&nbsp;|<br\s*\/?>)+$/i, "");
}

const ANKI_ANSWER_HR_RE = /<hr\b[^>]*\bid=["']?answer["']?[^>]*>/i;

function splitAnkiAnswer(html: string): { front: string; back: string } {
  const match = html.match(ANKI_ANSWER_HR_RE);
  if (!match || match.index === undefined) return { front: "", back: html };
  return {
    front: html.slice(0, match.index),
    back: html.slice(match.index + match[0].length),
  };
}

// The per-card actions menu shown on the study card (top-right, on hover). It
// hosts review-time actions like editing and suspending the note, and is the
// place to add more (bury, flag, …) over time.
function StudyCardMenu({
  onEdit,
  onSuspend,
  disabled,
  flag = 0,
  onSetFlag,
}: {
  onEdit: () => void;
  onSuspend: () => void;
  disabled: boolean;
  flag?: number;
  onSetFlag?: (flag: number) => void;
}) {
  return (
    // Align the icon with the first line of card text: the content has py-6
    // (24px) top padding and the button adds p-1.5 (6px), so offsetting the top
    // by 18px lands the glyph on that first line rather than floating above it.
    //
    // stopPropagation keeps clicks on the trigger — and on the portalled menu
    // items, whose React events bubble back through this wrapper — from
    // reaching the card body's reveal-on-click handler.
    <div
      className="absolute top-[1.125rem] right-3 z-10"
      onClick={(e) => e.stopPropagation()}
    >
      <ActionsMenu
        label="Card actions"
        menuClassName="min-w-[180px]"
        iconSize={20}
        triggerClassName={(open) =>
          `rounded-md p-1.5 text-foreground/30 transition-all hover:bg-foreground/5 hover:text-foreground/60 ${
            open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`
        }
        items={[
          { label: "Edit Note", kbd: "E", disabled, onSelect: onEdit },
          { label: "Suspend Note", kbd: "S", disabled, onSelect: onSuspend },
          {
            render: (close) => (
              <FlagPicker
                value={flag}
                onSelect={(f) => {
                  onSetFlag?.(f);
                  close();
                }}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

export function StudyCard({
  question,
  answer,
  isRevealed,
  onReveal,
  onAnswer,
  onEdit,
  onSuspend,
  answering,
  sounds,
  flag = 0,
  onSetFlag,
}: StudyCardProps) {
  const typed = useMemo(() => hasTypeCloze(question), [question]);
  // Swap the [anki:play:…] placeholders for inline play buttons; everything
  // below renders the processed HTML, while cloze/diff logic keeps the raw.
  const audio = useMemo(
    () => resolveCardAudio(question, answer, sounds),
    [question, answer, sounds]
  );
  const [typedValue, setTypedValue] = useState("");
  const [submittedValue, setSubmittedValue] = useState("");
  const [prevQuestion, setPrevQuestion] = useState(question);
  const [wasRevealed, setWasRevealed] = useState(isRevealed);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [question]);

  // Play buttons live inside imperatively-rendered HTML, so clicks are
  // handled by delegation. Capture phase so the card's reveal-on-click
  // handler never sees them.
  useEffect(() => {
    const body = cardBodyRef.current;
    if (!body) return;
    function handleClick(e: MouseEvent) {
      const button = (e.target as HTMLElement).closest?.("[data-audio-file]");
      if (!button) return;
      e.stopPropagation();
      e.preventDefault();
      const file = button.getAttribute("data-audio-file");
      if (file) playAudio([file]);
    }
    body.addEventListener("click", handleClick, true);
    return () => body.removeEventListener("click", handleClick, true);
  }, []);

  // Mark the play button(s) for the sounding file as active, so a card with
  // several clips shows which one is playing. Matched by filename, so if the
  // same file appears more than once every copy lights up together.
  useEffect(() => {
    const body = cardBodyRef.current;
    if (!body) return;
    return onPlayingFileChange((file) => {
      body.querySelectorAll<HTMLElement>("[data-audio-file]").forEach((btn) => {
        btn.classList.toggle(
          "is-playing",
          file !== null && btn.getAttribute("data-audio-file") === file
        );
      });
    });
  }, [audio]);

  // No autoplay here: the session drives Anki's real (offscreen) reviewer,
  // which already autoplays card audio per the deck's options — playing it
  // from Ankitron too sounds everything twice. Our player only handles
  // manual playback: the inline buttons and the `r` key.

  if (prevQuestion !== question) {
    setPrevQuestion(question);
    setTypedValue("");
    setSubmittedValue("");
  }

  // Anki can re-serve the very same card (e.g. after a Fail), so the question
  // string is unchanged and the reset above doesn't fire. Detect the fresh
  // serve by the reveal flag dropping back to false — submitting a typed answer
  // goes false→true, a (re)served card goes true→false — and clear the prior
  // input so the answer must be typed again.
  if (wasRevealed !== isRevealed) {
    setWasRevealed(isRevealed);
    if (!isRevealed) {
      setTypedValue("");
      setSubmittedValue("");
    }
  }

  useEffect(() => {
    if (typed && !isRevealed) {
      inputRef.current?.focus();
    }
  }, [typed, isRevealed, question]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Inert while answering, or while an overlay (card editor, confirm
      // dialog, command palette) is up over the card.
      if (answering || isScrollLocked()) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      // Reveal/grade keys are single-key shortcuts; a held modifier means the
      // user meant something else (e.g. Cmd+1/Cmd+2 nav), not a grade.
      const plainKey = !e.metaKey && !e.ctrlKey && !e.altKey;

      if (e.key === "r" && plainKey && !inEditable) {
        e.preventDefault();
        const files = isRevealed
          ? audio.answerFiles.length
            ? audio.answerFiles
            : audio.questionFiles
          : audio.questionFiles;
        if (files.length) playAudio(files);
        return;
      }

      // Suspend the current note, available before or after reveal.
      if (e.key === "s" && plainKey && !inEditable) {
        e.preventDefault();
        onSuspend();
        return;
      }

      if (!plainKey) return;

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
  }, [isRevealed, answering, onReveal, onAnswer, onSuspend, audio]);

  function handleSubmitTyped() {
    setSubmittedValue(typedValue);
    inputRef.current?.blur();
    onReveal();
  }

  const [questionBefore, questionAfter] = useMemo(
    () =>
      typed ? splitOnTypeCloze(audio.questionHtml) : [audio.questionHtml, ""],
    [typed, audio.questionHtml]
  );

  const cleanedAnswer = useMemo(
    () => (typed ? stripTypeCloze(audio.answerHtml) : audio.answerHtml),
    [typed, audio.answerHtml]
  );

  const splitAnswer = useMemo(() => splitAnkiAnswer(cleanedAnswer), [cleanedAnswer]);

  // For a non-typed cloze the part before `<hr id=answer>` is the revealed
  // sentence (cloze word filled in) — show it as its own section. A Basic
  // card's front re-renders identically to the question, so skip it there to
  // avoid duplicating the question section.
  const isClozeReveal = useMemo(
    () =>
      !typed &&
      splitAnswer.front.trim() !== "" &&
      splitAnswer.front.trim() !== question.trim(),
    [typed, splitAnswer.front, question]
  );

  const expectedAnswer = useMemo(
    () => (typed ? extractExpectedClozeAnswer(question, answer) : ""),
    [typed, question, answer]
  );

  const typedDiff = useMemo(() => {
    if (!typed || !submittedValue.trim() || !expectedAnswer) return null;
    return diffTypedAnswer(submittedValue.trim(), expectedAnswer);
  }, [typed, submittedValue, expectedAnswer]);

  // A flagged card is tinted rather than marked with a bar: the whole card
  // border takes the flag colour, and the front (the unrevealed content, or the
  // question section once revealed) gets a 10% fill of it. The back/answer
  // sections stay untinted. Both null when unflagged.
  const flagBorder = flagColor(flag);
  const flagFill = flagTint(flag);

  return (
    <div className="w-full max-w-2xl">
      <div
        ref={cardBodyRef}
        onClick={
          !isRevealed && !typed
            ? () => {
                const sel = window.getSelection();
                if (sel && sel.toString().trim()) return;
                onReveal();
              }
            : undefined
        }
        style={flagBorder ? { borderColor: flagBorder } : undefined}
        className={`study-card-body group relative rounded-xl border border-border shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${
          !isRevealed && !typed ? "cursor-pointer hover:bg-foreground/[0.02] transition-colors" : ""
        }`}
      >
        {/* Actions slot — always present so the content div below it keeps a
           stable position in the children array (otherwise React's
           reconciliation can destroy the selected text node). The menu is the
           home for per-card actions during review (edit, suspend, flag, …). */}
        <div key="actions-slot">
          <StudyCardMenu
            onEdit={onEdit}
            onSuspend={onSuspend}
            disabled={answering}
            flag={flag}
            onSetFlag={onSetFlag}
          />
        </div>

        {!isRevealed ? (
          <div
            key="content"
            className="rounded-xl pl-8 pr-12 py-6"
            style={flagFill ? { background: flagFill } : undefined}
          >
            {typed ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <HtmlContent html={questionBefore} />
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
                  spellCheck={false}
                  className="my-2 w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
                />
                <HtmlContent html={questionAfter} />
              </div>
            ) : (
              <HtmlContent
                html={audio.questionHtml}
                className="prose prose-sm dark:prose-invert max-w-none"
              />
            )}
          </div>
        ) : (
          <div key="content">
            {/* Section 1 — question. A subtle gray fill normally; the flag's
               10% tint when flagged (the answer sections below stay untinted). */}
            <div
              className={`rounded-t-xl pl-8 pr-12 py-6 ${
                flagFill ? "" : "bg-foreground/[0.03]"
              }`}
              style={flagFill ? { background: flagFill } : undefined}
            >
              <HtmlContent
                html={
                  typed
                    ? trimTrailingBreaks(questionBefore + questionAfter)
                    : audio.questionHtml
                }
                className="prose prose-sm dark:prose-invert max-w-none"
              />
            </div>

            {/* Section 2 — the revealed word or sentence. Each section after
               the first carries a full-width top border so the dividers run
               edge to edge across the card. */}
            {typed ? (
              <div
                className="study-answer prose prose-sm dark:prose-invert max-w-none border-t border-border pl-8 pr-12 py-3"
                style={flagBorder ? { borderTopColor: flagBorder } : undefined}
              >
                {typedDiff ? (
                  typedDiff.correct ? (
                    <div className="flex justify-center">
                      <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 font-mono text-sm text-emerald-600 dark:border-emerald-500/30 dark:text-emerald-400">
                        {submittedValue.trim()}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-center gap-3 font-mono text-sm">
                      <span className="inline-flex overflow-hidden rounded-md border border-border">
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
                      <span className="inline-flex overflow-hidden rounded-md border border-border">
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
              </div>
            ) : (
              isClozeReveal && (
                <div
                  className="study-answer prose prose-sm dark:prose-invert max-w-none border-t border-border pl-8 pr-12 py-6"
                  style={flagBorder ? { borderTopColor: flagBorder } : undefined}
                >
                  <HtmlContent html={splitAnswer.front} />
                </div>
              )
            )}

            {/* Section 3 — back of the card */}
            {splitAnswer.back.trim() && (
              <div
                className="study-answer prose prose-sm dark:prose-invert max-w-none border-t border-border pl-8 pr-12 py-6"
                style={flagBorder ? { borderTopColor: flagBorder } : undefined}
              >
                <HtmlContent html={splitAnswer.back} />
              </div>
            )}
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
