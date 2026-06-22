import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { SpeakerHigh } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import { Stop } from "@phosphor-icons/react/dist/ssr/Stop";
import { Ease } from "@/lib/types";
import { DeckLanguages, speak, stopSpeaking } from "@/lib/deck-settings";
import {
  getMediaUrl,
  MEDIA_ATTR,
  playAudio,
  prepareCardHtml,
  resolveCardAudio,
  stopAudio,
} from "@/lib/audio";
import {
  diffTypedAnswer,
  extractExpectedClozeAnswer,
  groupRuns,
} from "@/lib/typed-answer-diff";
import { isScrollLocked } from "@/hooks/use-scroll-lock";

interface StudyCardProps {
  question: string;
  answer: string;
  isRevealed: boolean;
  onReveal: () => void;
  onAnswer: (ease: Ease) => void;
  onEdit: () => void;
  answering: boolean;
  languages: DeckLanguages;
  /** Ordered [sound:…] filenames from the note's raw fields. */
  sounds: string[];
}

function describeLanguage(lang: string): string {
  try {
    const display = new Intl.DisplayNames(
      [typeof navigator !== "undefined" ? navigator.language : "en"],
      { type: "language" }
    );
    const name = display.of(lang);
    if (name && name !== lang) return name;
  } catch {
    // fall through
  }
  return lang;
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

/** Renders HTML imperatively via a ref so React never re-creates the
 * inner DOM on re-renders (which would destroy any selected text node
 * inside). */
function HtmlContent({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const renderedHtml = useRef<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Card media (<img>) references bare collection-media filenames the app
    // origin can't serve. prepareCardHtml strips those srcs (so no broken-image
    // icon flashes) and we pull each file from Anki, then fade the image in.
    // Only rewrite innerHTML when the html actually changes (avoids clobbering
    // selection); image resolution runs every invocation so StrictMode's
    // double-mount can't leave images stuck transparent. `cancelled` guards
    // against the html changing before a fetch resolves.
    if (renderedHtml.current !== html) {
      renderedHtml.current = html;
      el.innerHTML = prepareCardHtml(html);
    }
    let cancelled = false;
    el.querySelectorAll<HTMLImageElement>(`img[${MEDIA_ATTR}]`).forEach((img) => {
      const filename = img.getAttribute(MEDIA_ATTR) ?? "";
      getMediaUrl(filename).then((url) => {
        if (cancelled) return;
        if (url) {
          img.onload = () => {
            img.style.opacity = "1";
          };
          img.src = url;
        } else {
          // Missing/unreachable: reveal anyway so any alt text shows.
          img.style.opacity = "1";
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [html]);
  return <div ref={ref} className={className} />;
}

export function StudyCard({
  question,
  answer,
  isRevealed,
  onReveal,
  onAnswer,
  onEdit,
  answering,
  languages,
  sounds,
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
  const [speaking, setSpeaking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [prevRevealed, setPrevRevealed] = useState(isRevealed);
  const [selectionInfo, setSelectionInfo] = useState<{
    text: string;
    top: number;
    left: number;
    rects: { top: number; left: number; width: number; height: number }[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardBodyRef = useRef<HTMLDivElement>(null);
  const speakingRef = useRef(false);

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  const availableLanguages = useMemo(
    () =>
      [languages.primary, languages.secondary].filter(
        (l): l is string => !!l
      ),
    [languages]
  );

  useEffect(() => {
    return () => {
      stopSpeaking();
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

  // No autoplay here: the session drives Anki's real (offscreen) reviewer,
  // which already autoplays card audio per the deck's options — playing it
  // from Ankitron too sounds everything twice. Our player only handles
  // manual playback: the inline buttons and the `r` key.

  const updateFromSelection = useCallback(() => {
    if (availableLanguages.length === 0) return;
    const body = cardBodyRef.current;
    if (!body) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!sel || !text || sel.rangeCount === 0) {
      if (!speakingRef.current) {
        setSelectionInfo(null);
        setMenuOpen(false);
      }
      return;
    }
    const anchor = sel.anchorNode;
    if (!anchor || !body.contains(anchor)) {
      if (!speakingRef.current) {
        setSelectionInfo(null);
        setMenuOpen(false);
      }
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).map((r) => ({
      top: r.top - bodyRect.top,
      left: r.left - bodyRect.left,
      width: r.width,
      height: r.height,
    }));
    setSelectionInfo({
      text,
      top: rect.top - bodyRect.top,
      left: rect.left - bodyRect.left + rect.width / 2,
      rects,
    });
  }, [availableLanguages.length]);

  useEffect(() => {
    if (availableLanguages.length === 0) return;
    document.addEventListener("selectionchange", updateFromSelection);
    return () => {
      document.removeEventListener("selectionchange", updateFromSelection);
    };
  }, [availableLanguages.length, updateFromSelection]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        if (!speakingRef.current) setSelectionInfo(null);
      }
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  if (prevQuestion !== question) {
    setPrevQuestion(question);
    setTypedValue("");
    setSubmittedValue("");
    setMenuOpen(false);
    setSelectionInfo(null);
  }

  if (prevRevealed !== isRevealed) {
    setPrevRevealed(isRevealed);
    setMenuOpen(false);
    setSelectionInfo(null);
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
  }, [isRevealed, answering, onReveal, onAnswer, audio]);

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

  function speakText(text: string, lang: string) {
    if (!text) return;
    setSpeaking(true);
    speak(text, lang, {
      onEnd: () => {
        setSpeaking(false);
        setSelectionInfo(null);
        setMenuOpen(false);
      },
    });
  }

  function handleSpeakerClick() {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      setMenuOpen(false);
      setSelectionInfo(null);
      return;
    }
    if (!selectionInfo || availableLanguages.length === 0) return;
    if (availableLanguages.length === 1) {
      speakText(selectionInfo.text, availableLanguages[0]);
      return;
    }
    setMenuOpen((open) => !open);
  }

  function handleMenuPick(lang: string) {
    if (!selectionInfo) return;
    setMenuOpen(false);
    speakText(selectionInfo.text, lang);
  }

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
        className={`study-card-body group relative rounded-xl border border-foreground/10 shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${
          availableLanguages.length > 0 ? "has-voice-selection " : ""
        }${
          !isRevealed && !typed ? "cursor-pointer hover:bg-foreground/[0.02] transition-colors" : ""
        }`}
      >
        {/* Edit button slot — always present so the content div below it
           keeps a stable position in the children array (otherwise
           React's reconciliation can destroy the selected text node). */}
        <div key="edit-slot">
          {isRevealed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 rounded-md p-1.5 text-foreground/30 hover:text-foreground/60 hover:bg-foreground/5 transition-all"
              title="Edit card (e)"
            >
              <PencilSimple size={18} weight="regular" />
            </button>
          )}
        </div>

        {/* Highlight overlay slot — always present, conditionally filled. */}
        <div key="highlight-slot" aria-hidden>
          {selectionInfo &&
            availableLanguages.length > 0 &&
            selectionInfo.rects.map((r, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  top: r.top,
                  left: r.left,
                  width: r.width,
                  height: r.height,
                  backgroundColor: "rgba(250, 204, 21, 0.4)",
                  pointerEvents: "none",
                  borderRadius: 2,
                  zIndex: 10,
                }}
              />
            ))}
        </div>

        {/* Speaker icon slot — always present, conditionally filled. */}
        <div key="speaker-slot">
        {selectionInfo && availableLanguages.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: selectionInfo.top - 40,
              left: selectionInfo.left,
              transform: "translateX(-50%)",
              zIndex: 20,
            }}
          >
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                handleSpeakerClick();
              }}
              className={`flex h-8 w-8 items-center justify-center rounded-full border border-foreground/15 bg-background shadow-md transition-colors ${
                speaking
                  ? "text-foreground/80"
                  : "text-foreground/60 hover:text-foreground"
              }`}
              title={speaking ? "Stop" : "Speak selection"}
              aria-label={speaking ? "Stop" : "Speak selection"}
              aria-haspopup={availableLanguages.length > 1 ? "menu" : undefined}
              aria-expanded={availableLanguages.length > 1 ? menuOpen : undefined}
            >
              {speaking ? (
                <Stop size={14} weight="fill" />
              ) : (
                <SpeakerHigh size={14} weight="regular" />
              )}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute left-1/2 top-full mt-1 -translate-x-1/2 min-w-[140px] rounded-md border border-foreground/10 bg-background py-1 shadow-lg"
              >
                {availableLanguages.map((lang) => (
                  <button
                    key={lang}
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMenuPick(lang);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm text-foreground/80 hover:bg-foreground/5"
                  >
                    {describeLanguage(lang)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        </div>

        {!isRevealed ? (
          <div key="content" className="px-8 py-6">
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
                  className="my-2 w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
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
            {/* Section 1 — question (gray background) */}
            <div className="rounded-t-xl bg-foreground/[0.03] px-8 py-6">
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
              <div className="study-answer prose prose-sm dark:prose-invert max-w-none border-t border-foreground/10 px-8 py-3">
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
              </div>
            ) : (
              isClozeReveal && (
                <div className="study-answer prose prose-sm dark:prose-invert max-w-none border-t border-foreground/10 px-8 py-6">
                  <HtmlContent html={splitAnswer.front} />
                </div>
              )
            )}

            {/* Section 3 — back of the card */}
            {splitAnswer.back.trim() && (
              <div className="study-answer prose prose-sm dark:prose-invert max-w-none border-t border-foreground/10 px-8 py-6">
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
