import { useEffect, useRef, useState } from "react";
import { ankiFetch } from "@/lib/anki-fetch";
import { ensureClozeTypedModel } from "@/lib/cloze-typed-model";
import { Note } from "@/lib/types";
import {
  buildExport,
  downloadDeckJson,
  fetchCardDecksByNoteId,
  importDeck,
  isExportedDeck,
  type ExportedDeck,
  type ImportResult,
} from "@/lib/import-export";
import { ImportResultModal } from "./import-export";
import { ImportTargetDialog } from "./import-target-dialog";
import { useScrollLock } from "@/hooks/use-scroll-lock";

interface DecksImportExportProps {
  decks: string[];
}

export function DecksImportExport({ decks }: DecksImportExportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ExportedDeck | null>(null);
  const [importing, setImporting] = useState(false);
  const [showExportPicker, setShowExportPicker] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept after a successful import so "Overwrite anyway" can re-run it, and as
  // the signal that Anki changed and the page needs a reload on dismiss.
  const [lastImport, setLastImport] = useState<{
    target: string;
    parsed: ExportedDeck;
  } | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setResult(null);

    try {
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("Invalid JSON file.");
      }
      if (!isExportedDeck(json)) {
        throw new Error("File is not a valid deck export.");
      }
      setPending(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read file.");
    }
  }

  async function runImport(target: string, isNew: boolean) {
    if (!pending) return;
    setImporting(true);
    try {
      if (isNew) {
        await ankiFetch("createDeck", { deck: target });
      }
      const addOnly = target !== pending.deckName;
      const r = await importDeck(
        target,
        pending,
        { ankiFetch, ensureClozeTypedModel },
        { addOnly },
      );
      setResult(r);
      setLastImport({ target, parsed: pending });
      setPending(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
      setPending(null);
    } finally {
      setImporting(false);
    }
  }

  async function runOverwrite() {
    if (!lastImport) return;
    setImporting(true);
    try {
      const addOnly = lastImport.target !== lastImport.parsed.deckName;
      const r = await importDeck(
        lastImport.target,
        lastImport.parsed,
        { ankiFetch, ensureClozeTypedModel },
        { addOnly, overwriteStale: true },
      );
      setResult(r);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  function dismissResult() {
    // Reload only when an import actually ran, so the page reflects the new
    // cards; a parse/validation error changed nothing.
    if (lastImport) {
      window.location.reload();
      return;
    }
    setResult(null);
    setError(null);
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
        onClick={() => setShowExportPicker(true)}
        disabled={importing || decks.length === 0}
        className="rounded-lg border border-foreground/15 px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors disabled:opacity-50"
        title="Pick a deck and download it as JSON"
      >
        Export
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        className="rounded-lg border border-foreground/15 px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors disabled:opacity-50"
        title="Import notes from a JSON file"
      >
        {importing ? "Importing…" : "Import"}
      </button>

      {showExportPicker && (
        <ExportPickerDialog
          decks={decks}
          onCancel={() => setShowExportPicker(false)}
          onDone={() => setShowExportPicker(false)}
          onError={(msg) => {
            setShowExportPicker(false);
            setError(msg);
          }}
        />
      )}

      {pending && (
        <ImportTargetDialog
          parsed={pending}
          importing={importing}
          onCancel={() => setPending(null)}
          onConfirm={runImport}
        />
      )}

      {(result || error) && (
        <ImportResultModal
          result={result}
          error={error}
          importing={importing}
          onOverwriteStale={runOverwrite}
          onClose={dismissResult}
        />
      )}
    </>
  );
}

function ExportPickerDialog({
  decks,
  onCancel,
  onDone,
  onError,
}: {
  decks: string[];
  onCancel: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  useScrollLock();
  const [selected, setSelected] = useState<string>(decks[0] ?? "");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !working) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [working, onCancel]);

  async function handleExport() {
    if (!selected) return;
    setWorking(true);
    try {
      const noteIds = await ankiFetch<number[]>("findNotes", {
        query: `deck:"${selected}"`,
      });
      const notes =
        noteIds.length === 0
          ? []
          : await ankiFetch<Note[]>("notesInfo", { notes: noteIds });
      const cardDecksByNoteId = await fetchCardDecksByNoteId(notes, ankiFetch);
      const payload = buildExport(selected, notes, undefined, cardDecksByNoteId);
      await downloadDeckJson(payload, selected);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !working) onCancel();
      }}
    >
      <div
        className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg"
      >
        <h3 className="mb-1 text-lg font-semibold">Export deck</h3>
        <p className="mb-4 text-sm text-foreground/50">
          Choose a deck to download as a JSON file.
        </p>

        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          autoFocus
          className="w-full rounded-md border border-foreground/10 bg-transparent px-2 py-2 text-sm focus:border-foreground/30 focus:outline-none"
        >
          {decks.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={working}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={working || !selected}
            className="rounded-lg border border-foreground/15 px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            {working ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
