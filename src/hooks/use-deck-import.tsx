import { useState } from "react";
// importDeck takes the transport as an injected dependency (so its tests can
// run it against the demo mock); this raw import only feeds that parameter —
// it is not a protocol call, hence the targeted exemption from the UI-layer
// ban on the raw transport.
// eslint-disable-next-line no-restricted-imports
import { ankiFetch } from "@/lib/anki-fetch";
import { ensureClozeTypedModel } from "@/lib/cloze-typed-model";
import { createDeck } from "@/lib/decks";
import {
  importDeck,
  isExportedDeck,
  type ExportedDeck,
  type ImportResult,
} from "@/lib/import-export";
import { ImportTargetDialog } from "@/components/import-target-dialog";
import { ImportResultModal } from "@/components/import-result-modal";

/**
 * Drives the shared JSON-import flow: read a file, validate it, let the user
 * pick a target deck, run the import, and report the result. Returns the dialog
 * JSX so a caller only has to provide an entry point (a button or a file drop)
 * and render `dialogs`. Extracted so the Import button and drag-and-drop share
 * one controller rather than duplicating this state machine.
 */
export function useDeckImport() {
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

  async function beginImportFromFile(file: File) {
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
        await createDeck(target);
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

  const dialogs = (
    <>
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

  return {
    beginImportFromFile,
    importing,
    /** True while any import dialog is on screen — useful for guarding page hotkeys. */
    active: pending !== null || result !== null || error !== null,
    dialogs,
  };
}
