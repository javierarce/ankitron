import { useRef, useState } from "react";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import {
  buildExport,
  downloadDeckJson,
  fetchCardDecksByNoteId,
} from "@/lib/import-export";
import { useDeckImport } from "@/hooks/use-deck-import";
import { ImportResultModal } from "./import-result-modal";

interface ImportExportProps {
  deckName: string;
  notes: Note[];
}

export function ImportExport({ deckName, notes }: ImportExportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importer = useDeckImport({ currentDeck: deckName });
  // Export failures reuse the result modal purely as a generic error display;
  // kept local since they're unrelated to the shared import controller.
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExport() {
    setExportError(null);
    try {
      const cardDecksByNoteId = await fetchCardDecksByNoteId(notes, ankiFetch);
      const payload = buildExport(deckName, notes, undefined, cardDecksByNoteId);
      await downloadDeckJson(payload, deckName);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) importer.beginImportFromFile(file);
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={handleExport}
        disabled={importer.importing}
        className="shrink-0 rounded-md border border-foreground/15 px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-60"
        title="Download a JSON file with all notes in this deck"
      >
        Export
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importer.importing}
        className="shrink-0 rounded-md border border-foreground/15 px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-60"
        title="Import notes from a JSON file"
      >
        {importer.importing ? "Importing…" : "Import"}
      </button>

      {importer.dialogs}

      {exportError && (
        <ImportResultModal
          result={null}
          error={exportError}
          onClose={() => setExportError(null)}
        />
      )}
    </>
  );
}
