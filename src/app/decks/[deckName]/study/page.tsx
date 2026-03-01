"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { Ease, Note } from "@/lib/types";
import { StudyCard } from "@/components/study-card";
import { CardForm } from "@/components/card-form";
import { ankiFetch } from "@/lib/anki-fetch";

interface CurrentCard {
  cardId: number;
  noteId: number;
  question: string;
  answer: string;
}

export default function StudyPage() {
  const params = useParams();
  const deckName = decodeURIComponent(params.deckName as string);

  const [card, setCard] = useState<CurrentCard | null>(null);
  const [isRevealed, setIsRevealed] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const loadCurrentCard = useCallback(async () => {
    try {
      const result = await ankiFetch<CurrentCard | null>("guiCurrentCard");
      if (!result) {
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
  }, []);

  useEffect(() => {
    async function startReview() {
      setLoading(true);
      setError(null);
      try {
        await ankiFetch("guiDeckReview", { name: deckName });
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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (editingNote || showAddForm) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "a") {
        e.preventDefault();
        setShowAddForm(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingNote, showAddForm]);

  async function handleReveal() {
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
      // guiCurrentCard only returns cardId, so look up the noteId via cardsInfo
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
    // Restart deck review to force Anki to re-render the card with updated content
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
    <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center">
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
          <a
            href={`/decks/${encodeURIComponent(deckName)}`}
            className="rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background inline-block"
          >
            Back to Deck
          </a>
        </div>
      )}

      {!loading && !error && card && (
        <StudyCard
          question={card.question}
          answer={card.answer}
          isRevealed={isRevealed}
          onReveal={handleReveal}
          onAnswer={handleAnswer}
          onEdit={handleEdit}
          answering={answering}
        />
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

      {reviewed > 0 && (
        <p className="fixed bottom-4 right-6 text-sm text-foreground/30">
          {reviewed} reviewed
        </p>
      )}
    </div>
  );
}
