import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Ease, Note, NoteField } from "@/lib/types";
import { StudyCard } from "@/components/study-card";
import { CardForm } from "@/components/card-form";
import { ankiFetch } from "@/lib/anki-fetch";
import { extractSoundFilenames } from "@/lib/audio";
import { DeckLanguages, getDeckLanguages } from "@/lib/deck-settings";
import { isCardInDeck } from "@/lib/deck";
import { canUndo } from "@/lib/study";

// Duration of the card fade transitions (must match the CSS transition below).
const FADE_MS = 180;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CurrentCard {
  cardId: number;
  noteId: number;
  question: string;
  answer: string;
  deckName: string;
  fields: Record<string, NoteField>;
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
  const [cardVisible, setCardVisible] = useState(true);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "ok" | "error">("idle");
  const languages = useMemo<DeckLanguages>(
    () => getDeckLanguages(deckName),
    [deckName]
  );
  // Guards against overlapping reveal/answer transitions (e.g. mashing space).
  const transitioningRef = useRef(false);

  // The rendered HTML only carries [anki:play:…] placeholders; the filenames
  // behind them live in the raw fields (see resolveCardAudio).
  const sounds = useMemo(
    () => (card ? extractSoundFilenames(card.fields ?? {}) : []),
    [card]
  );

  const loadCurrentCard = useCallback(async () => {
    try {
      let result = await ankiFetch<CurrentCard | null>("guiCurrentCard");
      // A foreign card here usually means the reviewer queue is stale —
      // changeDeck writes raw SQL, so moving the current card to another deck
      // leaves it queued. Rebuild the queues and re-enter review once before
      // concluding the session is over.
      if (result?.deckName && !isCardInDeck(result.deckName, deckName)) {
        await ankiFetch("reloadCollection").catch(() => {});
        await ankiFetch("guiDeckReview", { name: deckName });
        result = await ankiFetch<CurrentCard | null>("guiCurrentCard");
      }
      // Anki's "current card" is collection-wide; never show a card that
      // belongs to another deck (or its breadcrumb would mismatch the card).
      if (!result || (result.deckName && !isCardInDeck(result.deckName, deckName))) {
        setCompleted(true);
        setCard(null);
      } else {
        setCard(result);
        setIsRevealed(false);
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
    // Undo only steps back through this session's reviews (see canUndo): not
    // once complete (no card to return to), and not before anything is reviewed
    // — Anki's undo is global, so it would otherwise reach into another deck.
    if (!canUndo({ completed, reviewed })) return;
    try {
      await ankiFetch("guiUndo");
    } catch {
      return;
    }
    setReviewed((r) => Math.max(0, r - 1));
    setSyncStatus("idle");
    // The undo reverts the collection, but the (hidden) reviewer defers its
    // own refresh until focused — guiCurrentCard would keep returning the
    // already-advanced card. Re-enter review to rebuild the queue; the
    // collection is back in its pre-answer state, so the undone card is
    // served again.
    try {
      await ankiFetch("guiDeckReview", { name: deckName });
    } catch {
      // ignore — loadCurrentCard will surface any real failure
    }
    await loadCurrentCard();
  }, [completed, reviewed, deckName, loadCurrentCard]);

  const handleEdit = useCallback(async () => {
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
  }, [card]);

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
      } else if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handleEdit();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingNote, showAddForm, navigate, deckName, handleEdit, handleUndo]);

  useEffect(() => {
    if (!completed || reviewed === 0 || syncStatus !== "idle") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this effect owns the sync state machine; the transition to "syncing" belongs with the request it starts
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
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    // Fade the question out, swap in the answer while hidden, then fade in.
    setCardVisible(false);
    await delay(FADE_MS);
    try {
      await ankiFetch("guiShowAnswer");
    } catch {
      // Showing the answer in Anki is best-effort; reveal locally regardless.
    }
    setIsRevealed(true);
    setCardVisible(true);
    transitioningRef.current = false;
  }

  async function handleEditClose() {
    // loadCurrentCard rebuilds the queue and resets to the question side; if the
    // answer was showing before the edit, restore it so editing doesn't bounce
    // the card back to its unanswered state.
    const wasRevealed = isRevealed;
    setEditingNote(null);
    try {
      await ankiFetch("guiDeckReview", { name: deckName });
    } catch {
      // ignore
    }
    await loadCurrentCard();
    if (wasRevealed) {
      try {
        await ankiFetch("guiShowAnswer");
      } catch {
        // Re-revealing in Anki is best-effort; reveal locally regardless.
      }
      setIsRevealed(true);
    }
  }

  async function handleAddSaved() {
    setShowAddForm(false);
    // Re-enter review so the freshly added card can join this session's queue.
    try {
      await ankiFetch("guiDeckReview", { name: deckName });
    } catch {
      // ignore
    }
    await loadCurrentCard();
  }

  async function handleAnswer(ease: Ease) {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    setAnswering(true);
    // Fade the answered card out, load the next card while hidden, then fade in.
    setCardVisible(false);
    await delay(FADE_MS);
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
      setCardVisible(true);
      transitioningRef.current = false;
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-[6rem]">
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
          {reviewed > 0 && syncStatus === "error" && (
            <div className="mb-4 flex flex-col items-center gap-2">
              <p className="text-xs text-foreground/40">Sync failed.</p>
              <button
                onClick={() => setSyncStatus("idle")}
                className="rounded-md border border-foreground/15 px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                Retry sync
              </button>
            </div>
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
        <div
          className="w-full max-w-2xl transition-opacity ease-out"
          style={{ opacity: cardVisible ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
        >
          <StudyCard
            question={card.question}
            answer={card.answer}
            isRevealed={isRevealed}
            onReveal={handleReveal}
            onAnswer={handleAnswer}
            onEdit={handleEdit}
            answering={answering}
            languages={languages}
            sounds={sounds}
          />
        </div>
      )}

      {showAddForm && (
        <CardForm
          deckName={deckName}
          onClose={() => setShowAddForm(false)}
          onSaved={handleAddSaved}
        />
      )}

      {editingNote && (
        <CardForm
          deckName={deckName}
          note={editingNote}
          onClose={handleEditClose}
          onSaved={handleEditClose}
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

      {reviewed > 0 && !completed && (
        <p className="fixed bottom-4 right-6 text-sm text-foreground/30">
          {initialTotal > 0
            ? `${reviewed > initialTotal ? `(+${reviewed - initialTotal}) ` : ""}${Math.min(reviewed, initialTotal)} / ${initialTotal}`
            : `${reviewed} reviewed`}
        </p>
      )}
    </div>
  );
}
