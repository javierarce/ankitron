"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";
import { ankiFetch } from "@/lib/anki-fetch";

interface DangerZoneProps {
  deckName: string;
}

export function DangerZone({ deckName }: DangerZoneProps) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await ankiFetch("deleteDecks", { decks: [deckName], cardsToo: true });
      router.push("/");
    } catch {
      setDeleting(false);
      setShowConfirm(false);
    }
  }

  return (
    <>
      <section className="mt-16 border-t border-red-500/20 pt-6">
        <h2 className="mb-1 text-sm font-semibold text-red-500">Danger Zone</h2>
        <p className="mb-4 text-sm text-foreground/50">
          Permanently delete this deck and all its cards from Anki.
        </p>
        <button
          onClick={() => setShowConfirm(true)}
          className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/5 transition-colors dark:border-red-500/30"
        >
          Delete Deck
        </button>
      </section>

      {showConfirm && (
        <ConfirmDialog
          title="Delete Deck"
          message={`Delete "${deckName}" and all its cards? This cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setShowConfirm(false)}
          loading={deleting}
        />
      )}
    </>
  );
}
