import { Spinner } from "./spinner";

/**
 * Full-screen, centered loading spinner. Used for the app's startup sequence —
 * both while waiting for Anki to be reachable and while the first page fetches
 * its data — so the two phases share one identical, continuously-positioned
 * spinner instead of two that visibly hand off to each other. `fixed inset-0`
 * with a solid background means it also covers the app chrome when shown over a
 * mounted page.
 */
export function FullScreenSpinner({ label }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="text-center">
        <Spinner />
        {label && <p className="mt-4 text-sm text-foreground/50">{label}</p>}
      </div>
    </div>
  );
}
