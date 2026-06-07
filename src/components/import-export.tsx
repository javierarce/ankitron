import { useRef, useState } from "react";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import { ensureClozeTypedModel } from "@/lib/cloze-typed-model";
import {
  buildExport,
  fetchCardDecksByNoteId,
  importDeck,
  isExportedDeck,
  sanitizeFilename,
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

  async function handleExport() {
    const cardDecksByNoteId = await fetchCardDecksByNoteId(notes, ankiFetch);
    const payload = buildExport(deckName, notes, undefined, cardDecksByNoteId);
    downloadDeckJson(payload, deckName);
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
      setPending(null);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
      setPending(null);
    } finally {
      setImporting(false);
    }
  }

  function dismissResult() {
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
          onClose={dismissResult}
        />
      )}
    </>
  );
}

export function downloadDeckJson(payload: ExportedDeck, name: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `${sanitizeFilename(name)}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ImportResultModal({
  result,
  error,
  onClose,
}: {
  result: ImportResult | null;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
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
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
