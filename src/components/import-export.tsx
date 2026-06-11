import { useRef, useState } from "react";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import { ensureClozeTypedModel } from "@/lib/cloze-typed-model";
import {
  buildExport,
  downloadDeckJson,
  fetchCardDecksByNoteId,
  importDeck,
  isExportedDeck,
  type ExportedDeck,
  type ImportResult,
} from "@/lib/import-export";
import { ImportTargetDialog } from "./import-target-dialog";

interface ImportExportProps {
  deckName: string;
  notes: Note[];
}

export function ImportExport({ deckName, notes }: ImportExportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ExportedDeck | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept after a successful import so "Overwrite anyway" can re-run it, and as
  // the signal that Anki changed and the page needs a reload on dismiss.
  const [lastImport, setLastImport] = useState<{
    target: string;
    parsed: ExportedDeck;
  } | null>(null);

  async function handleExport() {
    setError(null);
    try {
      const cardDecksByNoteId = await fetchCardDecksByNoteId(notes, ankiFetch);
      const payload = buildExport(deckName, notes, undefined, cardDecksByNoteId);
      await downloadDeckJson(payload, deckName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    }
  }

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
      const runResult = await importDeck(
        target,
        pending,
        { ankiFetch, ensureClozeTypedModel },
        { addOnly },
      );
      setResult(runResult);
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
      const runResult = await importDeck(
        lastImport.target,
        lastImport.parsed,
        { ankiFetch, ensureClozeTypedModel },
        { addOnly, overwriteStale: true },
      );
      setResult(runResult);
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
        onClick={handleExport}
        disabled={importing}
        className="rounded-lg border border-foreground/15 px-3 py-2 text-sm font-medium hover:bg-foreground/5 transition-colors disabled:opacity-50"
        title="Download a JSON file with all cards in this deck"
      >
        Export
      </button>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        className="rounded-lg border border-foreground/15 px-3 py-2 text-sm font-medium hover:bg-foreground/5 transition-colors disabled:opacity-50"
        title="Import cards from a JSON file"
      >
        {importing ? "Importing…" : "Import"}
      </button>

      {pending && (
        <ImportTargetDialog
          parsed={pending}
          currentDeck={deckName}
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

export function ImportResultModal({
  result,
  error,
  importing,
  onOverwriteStale,
  onClose,
}: {
  result: ImportResult | null;
  error: string | null;
  importing?: boolean;
  onOverwriteStale?: () => void;
  onClose: () => void;
}) {
  const staleSkipped = result?.staleSkipped ?? 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !importing) onClose();
      }}
    >
      <div
        className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg"
      >
        <h3 className="mb-2 text-lg font-semibold">
          {error ? "Import failed" : "Import complete"}
        </h3>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {result && (
          <div className="space-y-2 text-sm text-foreground/70">
            <p>
              Updated {result.updated} · Added {result.added}
              {result.skipped > 0 &&
                ` · Skipped ${result.skipped} (duplicates)`}
            </p>
            {staleSkipped > 0 && (
              <p>
                {staleSkipped} note{staleSkipped === 1 ? " was" : "s were"} not
                updated because the copy in Anki is newer than this export.
                Overwriting replaces {staleSkipped === 1 ? "it" : "them"} with
                the file&apos;s version, discarding any edits made in Anki
                since the export.
              </p>
            )}
            {result.errors.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-500">
                  {result.errors.length} error
                  {result.errors.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-2 list-disc pl-5 space-y-1">
                  {result.errors.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          {staleSkipped > 0 && onOverwriteStale && (
            <button
              onClick={onOverwriteStale}
              disabled={importing}
              className="rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              {importing ? "Overwriting…" : "Overwrite anyway"}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={importing}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
