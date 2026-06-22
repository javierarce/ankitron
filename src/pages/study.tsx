import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Ease, Note, NoteField } from "@/lib/types";
import { StudyCard } from "@/components/study-card";
import { CardForm } from "@/components/card-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ankiFetch } from "@/lib/anki-fetch";
import { extractSoundFilenames } from "@/lib/audio";
import { DeckLanguages, getDeckLanguages } from "@/lib/deck-settings";
import { coveringDecks, isCardInDeck } from "@/lib/deck";
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
  const [searchParams] = useSearchParams();
  const deckName = decodeURIComponent(params.deckName as string);

  // The selected segments this session is scoped to, from the "seg" query
  // params. Carried back to the deck page on exit so the selection survives a
  // round-trip into study.
  const segParams = useMemo(
    () => searchParams.getAll("seg").filter((d) => isCardInDeck(d, deckName)),
    [searchParams, deckName],
  );

  // The decks this session reviews, in order. The selected segments are reduced
  // to disjoint subtrees so none is studied twice; with none, the whole deck is
  // studied. Anki reviews one deck at a time, so we step through them,
  // re-entering review as each empties.
  const studyDecks = useMemo(() => {
    const cover = coveringDecks(segParams);
    return cover.length > 0 ? cover : [deckName];
  }, [segParams, deckName]);
  // Index into studyDecks of the deck currently being reviewed. A ref so the
  // async review loop always reads the latest value without re-subscribing.
  const deckIdxRef = useRef(0);

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
  // A pending "leave study" navigation while its confirm dialog is up (null =
  // no dialog). Shared by Cmd+←, Cmd+1, and Cmd+2. `state` carries router state
  // along — e.g. the selected segments back to the deck page.
  const [pendingExit, setPendingExit] = useState<{
    to: string;
    state?: unknown;
  } | null>(null);
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
      // Walk the remaining decks from the active one, serving the first card
      // we find. Each deck's queue is reviewed in turn; when one empties we
      // re-enter review on the next and keep going, only completing the session
      // once every deck is exhausted.
      for (let i = deckIdxRef.current; i < studyDecks.length; i++) {
        const deck = studyDecks[i];
        // The first deck is already in review (entered by startReview/the prior
        // card); enter each subsequent deck as we reach it.
        if (i !== deckIdxRef.current) {
          await ankiFetch("guiDeckReview", { name: deck });
        }
        let result = await ankiFetch<CurrentCard | null>("guiCurrentCard");
        // A foreign card here usually means the reviewer queue is stale —
        // changeDeck writes raw SQL, so moving the current card to another deck
        // leaves it queued. Rebuild the queues and re-enter review once before
        // moving on from this deck.
        if (result?.deckName && !isCardInDeck(result.deckName, deck)) {
          await ankiFetch("reloadCollection").catch(() => {});
          await ankiFetch("guiDeckReview", { name: deck });
          result = await ankiFetch<CurrentCard | null>("guiCurrentCard");
        }
        // Anki's "current card" is collection-wide; only show one that belongs
        // to this deck (or its breadcrumb would mismatch the card). Anything
        // else means this deck is done — advance to the next.
        if (result && result.deckName && isCardInDeck(result.deckName, deck)) {
          deckIdxRef.current = i;
          setCard(result);
          setIsRevealed(false);
          await ankiFetch("guiStartCardTimer");
          return;
        }
      }
      setCompleted(true);
      setCard(null);
    } catch {
      setCompleted(true);
      setCard(null);
    }
  }, [studyDecks]);

  useEffect(() => {
    async function startReview() {
      setLoading(true);
      setError(null);
      deckIdxRef.current = 0;
      try {
        await ankiFetch("guiDeckReview", { name: studyDecks[0] });
        try {
          // Sum across every deck in the session. The covering decks are
          // disjoint subtrees and getDeckStats counts are subtree-inclusive, so
          // adding them up gives the queue size without double-counting.
          const stats = await ankiFetch<
            Record<string, { new_count: number; learn_count: number; review_count: number }>
          >("getDeckStats", { decks: studyDecks });
          const total = Object.values(stats).reduce(
            (sum, s) =>
              sum +
              (s.new_count ?? 0) +
              (s.learn_count ?? 0) +
              (s.review_count ?? 0),
            0,
          );
          setInitialTotal(total);
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
  }, [studyDecks, loadCurrentCard]);

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
    // served again. (Undo steps back within the deck being reviewed; it doesn't
    // cross back into an earlier deck of a multi-deck session.)
    try {
      await ankiFetch("guiDeckReview", { name: studyDecks[deckIdxRef.current] });
    } catch {
      // ignore — loadCurrentCard will surface any real failure
    }
    await loadCurrentCard();
  }, [completed, reviewed, studyDecks, loadCurrentCard]);

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

  const requestExit = useCallback(
    (to: string, state?: unknown) => {
      // Leaving mid-session loses no review data — answers persist the moment
      // they're graded — but it abandons the queue and any revealed-not-graded
      // card. Confirm only once there's progress worth protecting.
      if (reviewed > 0 || isRevealed) {
        setPendingExit({ to, state });
      } else {
        navigate(to, state ? { state } : undefined);
      }
    },
    [reviewed, isRevealed, navigate],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (editingNote || showAddForm || pendingExit !== null) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "a" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShowAddForm(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "ArrowLeft") {
        e.preventDefault();
        // Carry the selected segments back so the deck page restores them.
        requestExit(
          `/decks/${encodeURIComponent(deckName)}`,
          segParams.length ? { segments: segParams } : undefined,
        );
      } else if ((e.metaKey || e.ctrlKey) && e.key === "1") {
        e.preventDefault();
        requestExit("/");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "2") {
        e.preventDefault();
        requestExit("/decks");
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
  }, [editingNote, showAddForm, pendingExit, deckName, segParams, requestExit, handleEdit, handleUndo]);

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
      await ankiFetch("guiDeckReview", { name: studyDecks[deckIdxRef.current] });
    } catch {
      // ignore
    }
    await loadCurrentCard();
    if (wasRevealed) {
      // Mirror handleReveal's fade: hide the question side, swap in the answer
      // while hidden, then fade it back in so the restore matches a manual reveal.
      setCardVisible(false);
      await delay(FADE_MS);
      try {
        await ankiFetch("guiShowAnswer");
      } catch {
        // Re-revealing in Anki is best-effort; reveal locally regardless.
      }
      setIsRevealed(true);
      setCardVisible(true);
    }
  }

  async function handleAddSaved() {
    setShowAddForm(false);
    // Re-enter review so the freshly added card can join this session's queue.
    try {
      await ankiFetch("guiDeckReview", { name: studyDecks[deckIdxRef.current] });
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

      {pendingExit !== null && (
        <ConfirmDialog
          title="Exit study session?"
          message="Cards you've graded are already saved. The rest of the queue will restart the next time you study this deck."
          confirmLabel="Exit"
          onConfirm={() =>
            navigate(
              pendingExit.to,
              pendingExit.state ? { state: pendingExit.state } : undefined,
            )
          }
          onCancel={() => setPendingExit(null)}
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
