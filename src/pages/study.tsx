import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Ease, Note } from "@/lib/types";
import { StudyCard } from "@/components/study-card";
import { CardForm } from "@/components/card-form";
import { ankiFetch } from "@/lib/anki-fetch";
import { DeckLanguages, getDeckLanguages } from "@/lib/deck-settings";
import { isCardInDeck } from "@/lib/deck";

interface CurrentCard {
  cardId: number;
  noteId: number;
  question: string;
  answer: string;
  deckName: string;
}

export function StudyPage() {
  const params = useParams();
  const navigate = useNavigate();
  const deckName = decodeURIComponent(params.deckName as string);

  const [card, setCard] = useState<CurrentCard | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [initialTotal, setInitialTotal] = useState(0);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [pinnedTop, setPinnedTop] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "ok" | "error">("idle");
  const [languages, setLanguages] = useState<DeckLanguages>({
    primary: null,
    secondary: null,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const cardSlotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLanguages(getDeckLanguages(deckName));
  }, [deckName]);

  const loadCurrentCard = useCallback(async () => {
    try {
      const result = await ankiFetch<CurrentCard | null>("guiCurrentCard");
      // Anki's "current card" is collection-wide; never show a card that
      // belongs to another deck (or its breadcrumb would mismatch the card).
      if (!result || (result.deckName && !isCardInDeck(result.deckName, deckName))) {
        setCompleted(true);
        setCard(null);
      } else {
        setCard(result);
        setIsRevealed(false);
        setPinnedTop(null);
        await ankiFetch("guiStartCardTimer");
      }
    } catch {
      setCompleted(true);
      setCard(null);
    }
  }, [deckName]);

  useEffect(() => {
    async function startReview() {
      setLoading(true);
      setError(null);
      try {
        await ankiFetch("guiDeckReview", { name: deckName });
        try {
          const stats = await ankiFetch<
            Record<string, { new_count: number; learn_count: number; review_count: number }>
          >("getDeckStats", { decks: [deckName] });
          const deckStats = Object.values(stats)[0];
          if (deckStats) {
            setInitialTotal(
              (deckStats.new_count ?? 0) +
                (deckStats.learn_count ?? 0) +
                (deckStats.review_count ?? 0)
            );
          }
        } catch {
          // progress bar will simply not show — non-fatal
        }
        await loadCurrentCard();
      } catch {
        setError(
          "Could not start review. Make sure Anki is running and the deck has due cards."
        );
      } finally {
        setLoading(false);
      }
    }
    startReview();
  }, [deckName, loadCurrentCard]);

  const handleUndo = useCallback(async () => {
    // Don't undo once the session is complete (there's no card to step back
    // into, so it would silently revert a review off-screen), or with nothing
    // reviewed in this deck's session — Anki's undo is global, so undoing then
    // would reach back into a previously studied deck and load one of its cards.
    if (completed || reviewed <= 0) return;
    try {
      await ankiFetch("guiUndo");
    } catch {
      return;
    }
    setReviewed((r) => Math.max(0, r - 1));
    setSyncStatus("idle");
    await loadCurrentCard();
  }, [completed, reviewed, loadCurrentCard]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (editingNote || showAddForm) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "a" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShowAddForm(true);
      } else if (e.key === "h" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        navigate(`/decks/${encodeURIComponent(deckName)}`);
      } else if ((e.key === "z" && !e.metaKey && !e.ctrlKey && !e.altKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        handleUndo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingNote, showAddForm, navigate, deckName, handleUndo]);

  useEffect(() => {
    if (!completed || reviewed === 0 || syncStatus !== "idle") return;
    let cancelled = false;
    setSyncStatus("syncing");
    (async () => {
      try {
        await ankiFetch("sync");
        if (!cancelled) {
          setSyncStatus("ok");
        }
      } catch {
        if (!cancelled) setSyncStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [completed, reviewed, syncStatus]);

  async function handleReveal() {
    const cardRect = cardSlotRef.current?.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (cardRect && containerRect) {
      setPinnedTop(cardRect.top - containerRect.top);
    }
    try {
      await ankiFetch("guiShowAnswer");
      setIsRevealed(true);
    } catch {
      setIsRevealed(true);
    }
  }

  async function handleEdit() {
    if (!card) return;
    try {
      const cardsResult = await ankiFetch<Record<string, unknown>[]>("cardsInfo", { cards: [card.cardId] });
      if (!cardsResult.length) return;
      const noteId = cardsResult[0].noteId ?? cardsResult[0].note;
      if (!noteId) return;
      const notes = await ankiFetch<Note[]>("notesInfo", { notes: [noteId] });
      if (notes.length > 0) {
        setEditingNote(notes[0]);
      }
    } catch {
      // silently fail
    }
  }

  async function handleEditClose() {
    setEditingNote(null);
    try {
      await ankiFetch("guiDeckReview", { name: deckName });
    } catch {
      // ignore
    }
    await loadCurrentCard();
  }

  async function handleAnswer(ease: Ease) {
    setAnswering(true);
    try {
      const success = await ankiFetch<boolean>("guiAnswerCard", { ease });
      if (success) {
        setReviewed((r) => r + 1);
        await loadCurrentCard();
      }
    } catch {
      setError("Failed to record answer. Try again.");
    } finally {
      setAnswering(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`flex flex-1 flex-col items-center pb-[6rem] ${
        pinnedTop === null ? "justify-center" : ""
      }`}
      style={pinnedTop !== null ? { paddingTop: pinnedTop } : undefined}
    >
      {loading && (
        <p className="text-foreground/50">Loading cards...</p>
      )}

      {error && <p className="text-red-500">{error}</p>}

      {!loading && !error && completed && (
        <div className="text-center">
          <p className="text-xl font-semibold mb-2">Session complete!</p>
          <p className="text-foreground/50 mb-6">
            {reviewed > 0
              ? `You reviewed ${reviewed} ${reviewed === 1 ? "card" : "cards"}.`
              : "No cards are due for review."}
          </p>
          {reviewed > 0 && (
            <p className="mb-4 text-xs text-foreground/40">
              {syncStatus === "syncing" && "Syncing with AnkiWeb\u2026"}
              {syncStatus === "ok" && "Synced with AnkiWeb."}
              {syncStatus === "error" && "Sync failed \u2014 try the Sync button."}
            </p>
          )}
          <a
            href="/"
            className="rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background inline-block"
          >
            Back to Study
          </a>
        </div>
      )}

      {!loading && !error && card && (
        <div ref={cardSlotRef} className="w-full max-w-2xl">
          <StudyCard
            question={card.question}
            answer={card.answer}
            isRevealed={isRevealed}
            onReveal={handleReveal}
            onAnswer={handleAnswer}
            onEdit={handleEdit}
            answering={answering}
            languages={languages}
          />
        </div>
      )}

      {showAddForm && (
        <CardForm
          deckName={deckName}
          onClose={() => setShowAddForm(false)}
        />
      )}

      {editingNote && (
        <CardForm
          deckName={deckName}
          note={editingNote}
          onClose={handleEditClose}
        />
      )}

      {!completed && initialTotal > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 h-1 bg-foreground/10"
          aria-hidden
        >
          <div
            className="h-full bg-foreground/60 transition-all duration-300 ease-out"
            style={{
              width: `${Math.min(100, (reviewed / initialTotal) * 100)}%`,
            }}
          />
        </div>
      )}

      {reviewed > 0 && (
        <p className="fixed bottom-4 right-6 text-sm text-foreground/30">
          {initialTotal > 0
            ? `${reviewed > initialTotal ? `(+${reviewed - initialTotal}) ` : ""}${Math.min(reviewed, initialTotal)} / ${initialTotal}`
            : `${reviewed} reviewed`}
        </p>
      )}
    </div>
  );
}
