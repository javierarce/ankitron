import { summarizeImport, type ImportResult } from "@/lib/import-export";
import { ModalDialog } from "./modal-dialog";

export function ImportResultModal({
  result,
  error,
  importing,
  onOverwriteStale,
  onClose,
  // Heading shown in the error case. Defaults to import wording; export reuses
  // this modal purely as an error display and overrides it.
  errorTitle = "Import failed",
}: {
  result: ImportResult | null;
  error: string | null;
  importing?: boolean;
  onOverwriteStale?: () => void;
  onClose: () => void;
  errorTitle?: string;
}) {
  const staleSkipped = result?.staleSkipped ?? 0;
  return (
    <ModalDialog
      title={error ? errorTitle : "Import complete"}
      titleClassName="mb-2"
      busy={importing}
      onClose={onClose}
      footer={
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
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            Close
          </button>
        </div>
      }
    >
      {error && <p className="text-sm text-red-500">{error}</p>}
      {result && (
        <div className="space-y-2 text-sm text-foreground/70">
          <p>{summarizeImport(result)}</p>
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
    </ModalDialog>
  );
}
