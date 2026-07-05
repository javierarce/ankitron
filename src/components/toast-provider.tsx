import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ToastContext } from "@/lib/toast-context";

const TOAST_DURATION_MS = 5000;

/**
 * App-wide transient error toasts, for mutations that fail after their UI has
 * moved on (a failed delete once the confirm dialog is gone, a drag-move, a
 * keyboard suspend) — there's nowhere inline left to say it failed.
 *
 * Kept deliberately minimal: errors only, and a new toast replaces the
 * current one instead of queueing — failures here are rare and share one root
 * cause (Anki unreachable), so the newest message is the one that matters.
 *
 * The toast is transient chrome, not a dialog: it takes no scroll lock and
 * intercepts no keyboard events, so shortcuts and open dialogs behave as if
 * it weren't there. Bottom-center keeps it clear of the sync indicator pinned
 * bottom-right (sync-provider.tsx).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(
    null,
  );
  const nextId = useRef(0);

  const error = useCallback((message: string) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message });
  }, []);

  // Auto-dismiss. Keyed on the toast object (fresh per error() call, id makes
  // that explicit), so re-showing — even the same message — restarts the clock.
  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const value = useMemo(() => ({ error }), [error]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        // The full-width positioner ignores the pointer so it never blocks
        // clicks along the bottom edge; only the pill itself is interactive.
        // z-[60] floats above dialogs (z-50) — a failure toast must be visible
        // even when a modal is open.
        <div
          role="alert"
          className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex justify-center px-4"
        >
          <button
            type="button"
            onClick={() => setToast(null)}
            title="Dismiss"
            className="pointer-events-auto flex max-w-full items-center gap-1.5 rounded-full border border-red-500/30 bg-background/80 px-3 py-1.5 text-sm text-red-500 shadow-sm backdrop-blur transition hover:bg-red-500/10"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full bg-red-500"
            />
            {toast.message}
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
