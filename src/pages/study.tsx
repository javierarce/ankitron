import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { CurrentCard, DueCounts, Ease, Note } from "@/lib/types";
import { StudyCard } from "@/components/study-card";
import { CardForm } from "@/components/card-form";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Tooltip } from "@/components/tooltip";
import { Spinner } from "@/components/spinner";
import { fetchAllDueCounts, syncCollection } from "@/lib/anki-fetch";
import { fetchCardState } from "@/lib/cards";
import { extractSoundFilenames } from "@/lib/audio";
import { fetchDeckNames, fetchDeckStats } from "@/lib/decks";
import {
  deckLeaf,
  formatDeckPath,
  nextDeckToStudy,
  studyableDecks,
} from "@/lib/deck";
import { fetchCardFlags, setNoteFlag } from "@/lib/flags";
import { useToast } from "@/lib/toast-context";
import {
  answerCard,
  resolveNoteForCard,
  showAnswer,
  undoReview,
} from "@/lib/review";
import {
  canUndo,
  createReviewSession,
  nextCard,
  reenterAndLoad,
  refreshCurrentCard,
  startSession,
  suspendCurrentAndAdvance,
  type NextCardResult,
  type ReviewSession,
} from "@/lib/review-session";

// Duration of the card fade transitions (must match the CSS transition below).
const FADE_MS = 180;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A study session's state (progress, completion, the served card) belongs to
// one deck. The completion screen can navigate straight into another deck's
// study URL, which only changes the route param — React Router would otherwise
// reuse the same StudyPage instance and carry its stale "complete" state over.
// Keying on the deck remounts it, so each deck starts a fresh session.
export function StudyRoute() {
  const { deckName } = useParams();
  return <StudyPage key={deckName} />;
}

function StudyPage() {
  const params = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  // React Router already URL-decodes path params; decoding again throws
  // URIError on any deck whose name contains a "%" and blanks the page.
  const deckName = params.deckName as string;

  // The decks this session reviews. Anki reviews one deck at a time, and a deck
  // pulls in its whole subtree, so studying the opened deck covers its subdecks.
  // A memo'd single-element array so the start effect's identity stays stable.
  const studyDecks = useMemo(() => [deckName], [deckName]);
  // The session state machine (deck cursor, queue walking, recovery) lives in
  // lib/review-session; the component only holds it and renders its results.
  // A ref so the async handlers always see the session the start effect built.
  const sessionRef = useRef<ReviewSession | null>(null);

  const [card, setCard] = useState<CurrentCard | null>(null);
  // The flag, tagged with the card it belongs to, so a just-served card never
  // flashes the previous card's flag while its own is being read. The bar and
  // menu use the derived `flag` below, which is 0 until this card's read lands.
  const [flagFor, setFlagFor] = useState<{ id: number; flag: number } | null>(
    null,
  );
  // Whether the served card is new, tagged with the card it belongs to (like
  // flagFor) so a just-served card never flashes the previous card's badge.
  // The derived `isNew` below is false until this card's state read lands.
  const [isNewFor, setIsNewFor] = useState<{ id: number; isNew: boolean } | null>(
    null,
  );
  const [isRevealed, setIsRevealed] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  // A snapshot of every deck and its due counts, prefetched in the background
  // once the session is under way (see the effect below) so the completion
  // screen can offer the next deck to study the instant the session ends,
  // rather than after a couple of AnkiConnect round trips. null until it lands.
  const [dueSnapshot, setDueSnapshot] = useState<{
    names: string[];
    counts: Record<string, DueCounts>;
  } | null>(null);
  const [reviewed, setReviewed] = useState(0);
  const [initialTotal, setInitialTotal] = useState(0);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  // A pending "leave study" navigation while its confirm dialog is up (null =
  // no dialog). Shared by Cmd+←, Cmd+1, and Cmd+2.
  const [pendingExit, setPendingExit] = useState<{ to: string } | null>(null);
  // Starts hidden so the first card fades in (see the rAF effect below) the same
  // way later cards do; the reveal/answer handlers drive it from then on.
  const [cardVisible, setCardVisible] = useState(false);
  // Fades the progress bar in once on mount, so it eases in rather than popping.
  const [barVisible, setBarVisible] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "ok" | "error">("idle");
  // Guards against overlapping reveal/answer transitions (e.g. mashing space).
  const transitioningRef = useRef(false);
  // The completion screen's primary action. Focused imperatively when it
  // appears (see the effect below): React silently drops autoFocus on an <a>
  // (what Link renders), so it wouldn't otherwise show a focus ring or answer
  // to Enter.
  const primaryActionRef = useRef<HTMLAnchorElement>(null);
  // Whether the flag was changed during the current card's review, so grading
  // knows to re-assert it (set or cleared) over the reviewer's stale card copy.
  const flagTouchedRef = useRef(false);

  // The rendered HTML only carries [anki:play:…] placeholders; the filenames
  // behind them live in the raw fields (see resolveCardAudio).
  const sounds = useMemo(
    () => (card ? extractSoundFilenames(card.fields ?? {}) : []),
    [card]
  );

  useEffect(() => {
    // Flip on the next frame so the browser sees the opacity-0 → opacity-100
    // change as a transition rather than the initial paint.
    const id = requestAnimationFrame(() => setBarVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Fades the first card in once it loads. Guarded so it runs a single time —
  // after that the reveal/answer handlers own cardVisible, and re-triggering
  // here would fight their fade-outs.
  const firstCardFadedRef = useRef(false);
  useEffect(() => {
    if (firstCardFadedRef.current || loading || !card) return;
    firstCardFadedRef.current = true;
    const id = requestAnimationFrame(() => setCardVisible(true));
    return () => cancelAnimationFrame(id);
  }, [loading, card]);

  // Render a session result: the next card, the completion screen, or — when
  // the walk hit a transport failure mid-session — the error state, so a
  // flaky AnkiConnect never masquerades as "Session complete!".
  const applyResult = useCallback(async (result: NextCardResult) => {
    if (result.kind === "card") {
      const served = result.card;
      // Read the flag and scheduling state before showing the card, so both
      // are present on its first paint rather than popping in a beat later.
      // guiCurrentCard carries neither, so these are separate reads; they run
      // in parallel while the card is still hidden mid-transition, overlapping
      // the fade. Each is independent (one failing doesn't drop the other), and
      // the state writes below batch into one render (React 18), so the card,
      // its bar, and its badge appear together.
      const [servedFlag, servedIsNew] = await Promise.all([
        fetchCardFlags([served.cardId])
          .then((flags) => flags.get(served.cardId) ?? 0)
          .catch(() => 0),
        fetchCardState(served.cardId)
          .then((state) => state === "new")
          .catch(() => false),
      ]);
      setFlagFor({ id: served.cardId, flag: servedFlag });
      setIsNewFor({ id: served.cardId, isNew: servedIsNew });
      // A freshly served card starts untouched — its flag matches what the
      // reviewer just cached, so grading needn't re-assert unless the user edits it.
      flagTouchedRef.current = false;
      setCard(served);
      setIsRevealed(false);
    } else if (result.kind === "completed") {
      setCompleted(true);
      setCard(null);
    } else {
      setError("Lost the connection to Anki mid-session.");
      setCard(null);
    }
  }, []);

  useEffect(() => {
    async function startReview() {
      setLoading(true);
      setError(null);
      const session = createReviewSession(studyDecks);
      sessionRef.current = session;
      try {
        await startSession(session);
        try {
          // Sum across every deck in the session. The covering decks are
          // disjoint subtrees and getDeckStats counts are subtree-inclusive, so
          // adding them up gives the queue size without double-counting.
          const stats = await fetchDeckStats(studyDecks);
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
        await applyResult(await nextCard(session));
      } catch {
        setError(
          "Could not start review. Make sure Anki is running and the deck has due cards."
        );
      } finally {
        setLoading(false);
      }
    }
    startReview();
  }, [studyDecks, applyResult]);

  const handleUndo = useCallback(async () => {
    // Undo only steps back through this session's reviews (see canUndo): not
    // once complete (no card to return to), and not before anything is reviewed
    // — Anki's undo is global, so it would otherwise reach into another deck.
    if (!canUndo({ completed, reviewed })) return;
    const session = sessionRef.current;
    if (!session || transitioningRef.current) return;
    transitioningRef.current = true;
    // Disable the grade controls for the duration of the transition, matching
    // handleAnswer/handleSuspend, so the buttons don't sit visually enabled
    // while the transitioningRef guard is quietly no-op'ing their clicks.
    setAnswering(true);
    try {
      await undoReview();
    } catch {
      setAnswering(false);
      transitioningRef.current = false;
      return;
    }
    setReviewed((r) => Math.max(0, r - 1));
    setSyncStatus("idle");
    // Fade the current card out while the queue is rebuilt and the undone card
    // is re-revealed, so the swap reads as a smooth transition rather than a snap.
    setCardVisible(false);
    await delay(FADE_MS);
    // The undo reverts the collection, but the (hidden) reviewer defers its
    // own refresh until focused — guiCurrentCard would keep returning the
    // already-advanced card. Re-enter review to rebuild the queue; the
    // collection is back in its pre-answer state, so the undone card is
    // served again. (Undo steps back within the deck being reviewed; it doesn't
    // cross back into an earlier deck of a multi-deck session.)
    const result = await reenterAndLoad(session);
    // The undone card comes back on its question side. Undoing a grade means the
    // user wants to change the vote they just cast, so put the answer straight
    // back up: flip Anki's offscreen reviewer to the answer side (grading only
    // lands once the answer is shown) and reveal locally, so they can re-vote
    // directly instead of revealing the card again first.
    if (result.kind === "card") {
      try {
        await showAnswer();
      } catch {
        // Re-revealing in Anki is best-effort; reveal locally regardless.
      }
    }
    await applyResult(result);
    if (result.kind === "card") setIsRevealed(true);
    setAnswering(false);
    setCardVisible(true);
    transitioningRef.current = false;
  }, [completed, reviewed, applyResult]);

  // The current card's flag, or 0 if flagFor belongs to a card already
  // replaced. Derived so switching cards can't show a stale flag. The read
  // itself happens in applyResult, before the card is shown, so the bar is
  // present on the card's first paint rather than fading in late.
  const cardId = card?.cardId;
  const flag = cardId != null && flagFor?.id === cardId ? flagFor.flag : 0;
  // The current card's "new" badge state, or false if isNewFor belongs to a
  // card already replaced — same guard as `flag`, so the badge can't linger
  // from the previous card while this one's state read is still in flight.
  const isNew = cardId != null && isNewFor?.id === cardId ? isNewFor.isNew : false;

  // Flag (or clear) the current card. Applied to the whole note's cards, like
  // suspension, so the deck list — which shows a note's flag from its first
  // card — stays in sync. Optimistic: the bar updates immediately and reverts
  // if the write fails. A failure only toasts (like the deck list) rather than
  // erroring the page — flagging is an optional annotation and mustn't tear
  // down the review card the way a failed grade/suspend does.
  const handleSetFlag = useCallback(
    async (next: number) => {
      if (!card) return;
      const prev = flag;
      if (prev === next) return;
      // Mark that the flag was changed for this card, so the answer handler
      // knows to re-assert it against the offscreen reviewer's stale copy —
      // including a clear (0), which the > 0 re-assert below would otherwise miss.
      flagTouchedRef.current = true;
      setFlagFor({ id: card.cardId, flag: next });
      try {
        const note = await resolveNoteForCard(card.cardId);
        const cardIds = note?.cards?.length ? note.cards : [card.cardId];
        await setNoteFlag(cardIds, next);
      } catch {
        setFlagFor({ id: card.cardId, flag: prev });
        toast.error("Couldn't update the flag. Is Anki still running?");
      }
    },
    [card, flag, toast],
  );

  const handleEdit = useCallback(async () => {
    if (!card) return;
    try {
      const note = await resolveNoteForCard(card.cardId);
      if (note) {
        setEditingNote(note);
      }
    } catch {
      // silently fail
    }
  }, [card]);

  const requestExit = useCallback(
    (to: string) => {
      // Leaving mid-session loses no review data — answers persist the moment
      // they're graded — but it abandons the queue and any revealed-not-graded
      // card. Confirm only once there's progress worth protecting.
      if (reviewed > 0 || isRevealed) {
        setPendingExit({ to });
      } else {
        navigate(to);
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
        requestExit(`/decks/${encodeURIComponent(deckName)}`);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        requestExit("/");
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        requestExit("/decks");
      } else if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handleEdit();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && /^[0-7]$/.test(e.key)) {
        // Cmd/Ctrl+1…7 sets the matching flag, Anki-style; pressing the current
        // flag's number again clears it. Cmd/Ctrl+0 always clears.
        e.preventDefault();
        const n = Number(e.key);
        handleSetFlag(flag === n ? 0 : n);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingNote, showAddForm, pendingExit, deckName, requestExit, handleEdit, handleUndo, handleSetFlag, flag]);

  useEffect(() => {
    if (!completed || reviewed === 0 || syncStatus !== "idle") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this effect owns the sync state machine; the transition to "syncing" belongs with the request it starts
    setSyncStatus("syncing");
    (async () => {
      try {
        await syncCollection();
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

  // Prefetch the deck list and due counts in the background as soon as the first
  // card is up, so the completion screen's "study next" button is ready the
  // instant the session ends instead of after a couple of AnkiConnect round
  // trips. Gated on !loading so it never competes with serving the first card.
  // Studying this deck doesn't change any other deck's due counts, so a snapshot
  // taken mid-session is still accurate at completion.
  useEffect(() => {
    if (loading || error) return;
    let cancelled = false;
    (async () => {
      try {
        const names = await fetchDeckNames();
        const counts = await fetchAllDueCounts(names);
        if (!cancelled) setDueSnapshot({ names, counts });
      } catch {
        // Couldn't read the collection — resolve to an empty snapshot so the
        // completion screen falls back to "nothing else to study" rather than
        // waiting on a button that never arrives.
        if (!cancelled) setDueSnapshot({ names: [], counts: {} });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, error]);

  // The deck to offer studying next, derived from the prefetched snapshot: a
  // sibling with due cards if there is one, else the next due deck anywhere
  // (nextDeckToStudy). `nextResolved` is true once the snapshot has landed, so
  // the completion screen's actions reflect reality rather than flashing a guess.
  const nextResolved = dueSnapshot !== null;
  const nextDeck = dueSnapshot
    ? nextDeckToStudy(
        deckName,
        studyableDecks(dueSnapshot.names, (d) => {
          const c = dueSnapshot.counts[d];
          return c ? c.new + c.learn + c.review > 0 : false;
        }),
      )
    : null;

  // Where the completion screen's primary action goes: straight into the next
  // due deck's session, or the decks page when nothing else is due.
  const continueTarget = nextDeck
    ? `/decks/${encodeURIComponent(nextDeck)}/study`
    : "/decks";

  // Focus the primary action once the completion screen shows it, so it reads a
  // focus ring and Enter activates it. Skipped while a form/dialog is up so we
  // never pull focus out from under the add/edit form or the exit confirm.
  useEffect(() => {
    if (!completed || !nextResolved) return;
    if (editingNote || showAddForm || pendingExit !== null) return;
    primaryActionRef.current?.focus();
  }, [completed, nextResolved, editingNote, showAddForm, pendingExit]);

  // After grading the last card the user's hands are still on the keyboard, so
  // Space advances the completion screen the way it drove the cards — into the
  // next deck, or to the decks page. Waits for nextResolved so it never fires
  // toward a target that's still being worked out. A separate listener from the
  // in-session shortcuts above (which ignore Space), scoped to the done screen.
  useEffect(() => {
    if (!completed) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (editingNote || showAddForm || pendingExit !== null) return;
      const tag = (e.target as HTMLElement)?.tagName;
      // Also bail on BUTTON: Space is the native activation key for buttons, so
      // a keyboard user pressing Space on a focused control (e.g. "Retry sync",
      // or a header button) must activate it rather than advance the screen.
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "BUTTON" ||
        (e.target as HTMLElement)?.isContentEditable
      )
        return;
      if (e.key === " ") {
        e.preventDefault();
        if (nextResolved) navigate(continueTarget);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [completed, nextResolved, continueTarget, editingNote, showAddForm, pendingExit, navigate]);

  async function handleReveal() {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    // Keep the grade controls disabled through the transition (like the answer
    // and suspend handlers) rather than leaving them visually enabled while the
    // transitioningRef guard silently no-ops their clicks.
    setAnswering(true);
    // Fade the question out, swap in the answer while hidden, then fade in.
    setCardVisible(false);
    await delay(FADE_MS);
    try {
      await showAnswer();
    } catch {
      // Showing the answer in Anki is best-effort; reveal locally regardless.
    }
    setIsRevealed(true);
    setAnswering(false);
    setCardVisible(true);
    transitioningRef.current = false;
  }

  function handleEditClose() {
    // Closing the editor without saving touches nothing, so just dismiss it and
    // leave the card (and its revealed state) exactly as they were — reloading
    // here would flash the card back to the question side for no reason.
    setEditingNote(null);
  }

  async function handleEditSaved(updated?: Note) {
    // CardForm passes the note only when fields/tags/deck actually changed; a
    // no-op save reports back with no argument. Nothing changed means nothing to
    // reload — treat it like a plain close.
    if (!updated) {
      setEditingNote(null);
      return;
    }
    // Something changed, so refresh to pick up the edit. Wrap the whole swap in
    // a single fade so it reads as a smooth transition rather than a snap, and
    // restore the answer side if it was showing before the edit.
    const session = sessionRef.current;
    const wasRevealed = isRevealed;
    const editedCardId = card?.cardId;
    setCardVisible(false);
    setEditingNote(null);
    await delay(FADE_MS);

    // Refresh the edited card *in place* rather than re-entering review, so
    // an edit doesn't jump to the next card; null means the card left this
    // deck (moved, or its note type changed) and we should advance instead —
    // see refreshCurrentCard for the protocol details.
    const refreshed =
      session && editedCardId != null
        ? await refreshCurrentCard(session, editedCardId)
        : null;

    if (refreshed) {
      setCard(refreshed);
      // Editing the note resets Anki's offscreen reviewer to the question side.
      // If the answer was showing before the edit, put the reviewer back into
      // its "answer" state so grading (guiAnswerCard, which only works once the
      // answer is shown) still lands — otherwise the grade keys would silently
      // do nothing.
      if (wasRevealed) {
        try {
          await showAnswer();
        } catch {
          // Re-revealing in Anki is best-effort; reveal locally regardless.
        }
      }
      setIsRevealed(wasRevealed);
    } else if (session) {
      // The card left this deck (moved or its note type changed). Rebuild the
      // queue and serve whatever's next.
      await applyResult(await reenterAndLoad(session));
      if (wasRevealed) {
        try {
          await showAnswer();
        } catch {
          // Re-revealing in Anki is best-effort; reveal locally regardless.
        }
        setIsRevealed(true);
      }
    }
    setCardVisible(true);
  }

  async function handleAddSaved() {
    setShowAddForm(false);
    const session = sessionRef.current;
    if (!session) return;
    // Re-enter review so the freshly added card can join this session's queue.
    await applyResult(await reenterAndLoad(session));
  }

  async function handleSuspend() {
    const session = sessionRef.current;
    if (!card || !session || transitioningRef.current) return;
    transitioningRef.current = true;
    setAnswering(true);
    // Fade the card out, drop the note from the queue while hidden, then fade in.
    setCardVisible(false);
    await delay(FADE_MS);
    try {
      // Suspend the whole note (not just this card — see the session module
      // for why), rebuild the queue, and serve the next card. Suspending isn't
      // a review, so the reviewed count is left untouched.
      await applyResult(await suspendCurrentAndAdvance(session, card));
    } catch {
      setError("Failed to suspend note. Try again.");
    } finally {
      setAnswering(false);
      setCardVisible(true);
      transitioningRef.current = false;
    }
  }

  async function handleAnswer(ease: Ease) {
    const session = sessionRef.current;
    if (!session || transitioningRef.current) return;
    // The card (and its flag) at the moment of grading, captured before the
    // queue advances so the flag re-assert below targets the right card.
    // `flagTouched` gates the re-assert: only a flag the user changed this card
    // can be clobbered, and we must re-assert a clear (0) as well as a set.
    const answeredId = card?.cardId;
    const answeredFlag = flag;
    const flagTouched = flagTouchedRef.current;
    transitioningRef.current = true;
    setAnswering(true);
    // Fade the answered card out, load the next card while hidden, then fade in.
    setCardVisible(false);
    await delay(FADE_MS);
    try {
      const success = await answerCard(ease);
      if (success) {
        setReviewed((r) => r + 1);
        await applyResult(await nextCard(session));
        // Re-assert the graded card's flag — LAST, after the queue has advanced
        // off it. Anki's offscreen reviewer caches the card it served and can
        // re-save it (from that cached copy) as it grades and moves on, undoing
        // a flag the user changed mid-review back to its served value. Writing it
        // after the advance wins that race, so the change survives being studied.
        // Gated on `flagTouched` (only a change made this card can be clobbered)
        // and re-asserts whatever it now is — a color or a clear (0). Fire-and-
        // forget: nothing downstream waits on it.
        if (answeredId != null && flagTouched) {
          void setNoteFlag([answeredId], answeredFlag).catch(() => {});
        }
      }
    } catch {
      setError("Failed to record answer. Try again.");
    } finally {
      setAnswering(false);
      setCardVisible(true);
      transitioningRef.current = false;
    }
  }

  // Once `reviewed` passes the initial queue size the planned set is cleared and
  // any further reviews are repeats from cards that lapsed back in. The real
  // remaining count is unknowable, so the bar simply holds full. The overflow
  // count is acknowledged afterwards on the completion screen.
  const progressWidth =
    initialTotal > 0
      ? reviewed >= initialTotal
        ? 100
        : (reviewed / initialTotal) * 100
      : 0;
  const extraReviews =
    initialTotal > 0 ? Math.max(0, reviewed - initialTotal) : 0;

  // Hover text for the progress bar. With a known queue size, show "n of N
  // cards" until the queue is cleared, then just "N cards"; either way append
  // "+ m repeats" once cards have lapsed back in. No size known → plain count.
  const repeatsSuffix =
    extraReviews > 0
      ? ` + ${extraReviews} ${extraReviews === 1 ? "repeat" : "repeats"}`
      : "";
  const progressLabel =
    initialTotal > 0
      ? `${reviewed >= initialTotal ? `${initialTotal}` : `${reviewed} of ${initialTotal}`} ${initialTotal === 1 ? "card" : "cards"}${repeatsSuffix}`
      : `${reviewed} reviewed`;

  return (
    <div className="flex flex-1 flex-col items-center justify-center pb-[6rem]">
      {loading && <Spinner role="status" aria-label="Loading cards" />}

      {error && <p className="text-red-500">{error}</p>}

      {!loading && !error && completed && (
        <div className="text-center">
          <p className="text-xl font-semibold mb-2">Session complete!</p>
          <div className="mb-6">
            <p className="text-foreground/50">
              {reviewed > 0
                ? `You reviewed ${reviewed} ${reviewed === 1 ? "card" : "cards"}.`
                : "No cards are due for review."}
            </p>
            {extraReviews > 0 && (
              <p className="mt-1 text-sm text-foreground/40">
                {extraReviews === 1
                  ? "1 was a repeat from a card that lapsed."
                  : `${extraReviews} were repeats from cards that lapsed.`}
              </p>
            )}
          </div>
          {reviewed > 0 && syncStatus === "error" && (
            <div className="mb-4 flex flex-col items-center gap-2">
              <p className="text-xs text-foreground/40">Sync failed.</p>
              <button
                onClick={() => setSyncStatus("idle")}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                Retry sync
              </button>
            </div>
          )}
          {nextResolved && (
            <div className="fade-in flex flex-col items-center gap-3">
              {nextDeck ? (
                <>
                  <Link
                    ref={primaryActionRef}
                    to={continueTarget}
                    className="inline-block max-w-xs truncate rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background"
                    title={`Study ${formatDeckPath(nextDeck)}`}
                  >
                    Continue with {deckLeaf(nextDeck)}
                  </Link>
                  <Link
                    to="/"
                    className="text-sm text-foreground/50 transition-colors hover:text-foreground"
                  >
                    Back to Study
                  </Link>
                </>
              ) : (
                <Link
                  ref={primaryActionRef}
                  to={continueTarget}
                  className="inline-block rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background"
                >
                  Go to Decks
                </Link>
              )}
            </div>
          )}
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
            onSuspend={handleSuspend}
            answering={answering}
            sounds={sounds}
            flag={flag}
            onSetFlag={handleSetFlag}
            isNew={isNew}
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
          onSaved={handleEditSaved}
        />
      )}

      {pendingExit !== null && (
        <ConfirmDialog
          title="Exit study session?"
          message="Cards you've graded are already saved. The rest of the queue will restart the next time you study this deck."
          confirmLabel="Exit"
          onConfirm={() => navigate(pendingExit.to)}
          onCancel={() => setPendingExit(null)}
        />
      )}

      {!completed && (
        <div
          className="fixed bottom-6 right-6 transition-opacity duration-500 ease-out"
          style={{ opacity: barVisible ? 1 : 0 }}
        >
          <Tooltip side="top" content={progressLabel}>
            <div
              className="h-2 w-[200px] overflow-hidden rounded-full border border-border bg-foreground/[0.04]"
              aria-hidden
            >
              <div
                className="h-full rounded-full bg-foreground/[0.12] transition-all duration-300 ease-out"
                style={{ width: `${progressWidth}%` }}
              />
            </div>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
