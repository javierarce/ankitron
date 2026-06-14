import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DangerZone } from "@/components/danger-zone";
import { DeckSettings } from "@/components/deck-settings";
import { ImportExport } from "@/components/import-export";
import { RenameDeckDialog } from "@/components/rename-deck-dialog";
import { ankiFetch } from "@/lib/anki-fetch";
import { renameDeck } from "@/lib/deck";
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

  const [showRename, setShowRename] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  async function handleRename(newName: string) {
    setRenaming(true);
    setRenameError(null);
    try {
      const renames = await renameDeck(deckName, newName, ankiFetch);
      if (renames.length === 0) {
        // No-op (e.g. a case-only change) — nothing moved, so stay put.
        setShowRename(false);
        setRenaming(false);
        return;
      }
      migrateDeckLanguages(renames);
      // The destination is the same route, so this component reconciles in place
      // rather than remounting — clear the dialog state ourselves or it stays
      // stuck on "Renaming…" (which also blocks its Escape/backdrop dismissal).
      setShowRename(false);
      setRenaming(false);
      navigate(`/decks/${encodeURIComponent(newName.trim())}/settings`, {
        replace: true,
      });
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Rename failed.");
      setRenaming(false);
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

  return (
    <div className="mx-auto w-full max-w-lg">
      <h1 className="mb-6 text-xl font-semibold">Deck Settings</h1>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <div className="divide-y divide-foreground/10">
        <div className="flex items-center justify-between gap-4 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Deck name</p>
            <p className="truncate text-xs text-foreground/50">{deckName}</p>
          </div>
          <button
            onClick={() => {
              setRenameError(null);
              setShowRename(true);
            }}
            className="shrink-0 rounded-md border border-foreground/15 px-3 py-1.5 text-sm text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            Rename
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
          renaming={renaming}
          error={renameError}
          onCancel={() => setShowRename(false)}
          onConfirm={handleRename}
        />
      )}
    </div>
  );
}
