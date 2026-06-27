import { summarizeImport, type ImportResult } from "@/lib/import-export";
import { useScrollLock } from "@/hooks/use-scroll-lock";

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
  useScrollLock();
  const staleSkipped = result?.staleSkipped ?? 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !importing) onClose();
      }}
    >
      <div
        className="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-lg"
      >
        <h3 className="mb-2 text-lg font-semibold">
          {error ? "Import failed" : "Import complete"}
        </h3>
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
      </div>
    </div>
  );
}
