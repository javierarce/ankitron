import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DangerZone } from "@/components/danger-zone";
import { DeckSettings } from "@/components/deck-settings";
import { ImportExport } from "@/components/import-export";
import { MoveDeckDialog } from "@/components/move-deck-dialog";
import { RenameDeckDialog } from "@/components/rename-deck-dialog";
import { ankiFetch } from "@/lib/anki-fetch";
import { deckLeaf, deckParent, formatDeckPath, renameDeck } from "@/lib/deck";
import { migrateDeckLanguages } from "@/lib/deck-settings";
import type { Note } from "@/lib/types";

export function DeckSettingsPage() {
  const { deckName: rawName } = useParams<{ deckName: string }>();
  const deckName = decodeURIComponent(rawName!);
  const navigate = useNavigate();

  // Loaded only so Export has the deck's notes to write out.
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Rename and Move both produce a new full deck name and run the same flow.
  const [showRename, setShowRename] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function applyRename(newName: string) {
    setBusy(true);
    setActionError(null);
    try {
      const renames = await renameDeck(deckName, newName, ankiFetch);
      // The destination is the same route, so this component reconciles in place
      // rather than remounting — clear dialog state ourselves or it stays stuck
      // (which also blocks the dialog's Escape/backdrop dismissal).
      setShowRename(false);
      setShowMove(false);
      setBusy(false);
      // No-op (e.g. a case-only change) — nothing moved, so stay put.
      if (renames.length === 0) return;
      migrateDeckLanguages(renames);
      navigate(`/decks/${encodeURIComponent(newName)}/settings`, {
        replace: true,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rename failed.");
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const noteIds = await ankiFetch<number[]>("findNotes", {
          query: `deck:"${deckName}"`,
        });
        const fetchedNotes =
          noteIds.length === 0
            ? []
            : await ankiFetch<Note[]>("notesInfo", { notes: noteIds });
        if (!cancelled) setNotes(fetchedNotes);
      } catch {
        if (!cancelled)
          setError("Could not load this deck. Make sure Anki is running.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [deckName]);

  const parent = deckParent(deckName);

  return (
    <div className="mx-auto w-full max-w-lg">
      <h1 className="mb-6 text-xl font-semibold">Deck Settings</h1>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <div className="divide-y divide-foreground/10">
        <div className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Deck name</p>
            <p className="truncate text-xs text-foreground/50">
              {deckLeaf(deckName)}
            </p>
          </div>
          <button
            onClick={() => {
              setActionError(null);
              setShowRename(true);
            }}
            className="shrink-0 rounded-md border border-foreground/15 px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5"
          >
            Rename
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Location</p>
            <p className="truncate text-xs text-foreground/50">
              {parent ? formatDeckPath(parent) : "Top level"}
            </p>
          </div>
          <button
            onClick={() => {
              setActionError(null);
              setShowMove(true);
            }}
            className="shrink-0 rounded-md border border-foreground/15 px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5"
          >
            Move
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-medium">Import &amp; Export</p>
            <p className="text-xs text-foreground/50">
              Export this deck to a JSON file, or import cards from one.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!loading && <ImportExport deckName={deckName} notes={notes} />}
          </div>
        </div>

        <DeckSettings deckName={deckName} />
      </div>

      <DangerZone deckName={deckName} />

      {showRename && (
        <RenameDeckDialog
          deckName={deckName}
          renaming={busy}
          error={actionError}
          onCancel={() => setShowRename(false)}
          onConfirm={applyRename}
        />
      )}

      {showMove && (
        <MoveDeckDialog
          deckName={deckName}
          moving={busy}
          error={actionError}
          onCancel={() => setShowMove(false)}
          onConfirm={applyRename}
        />
      )}
    </div>
  );
}
