import type { HTMLAttributes } from "react";

/**
 * The app's loading spinner: a ring with a translucent track and a solid
 * leading edge. Size and ring colors are fixed variants rather than free-form
 * classes — Tailwind resolves conflicting utilities by stylesheet order, not
 * className order, so appended overrides would apply unpredictably.
 */
const SIZES = {
  /** Corner sync badge. */
  xs: "h-3 w-3",
  /** Inline in a button, next to its label. */
  sm: "h-4 w-4",
  /** Page-level loading states. */
  md: "h-6 w-6",
} as const;

const TONES = {
  default: "border-foreground/20 border-t-foreground",
  /** Softer leading edge, for peripheral indicators like the sync badge. */
  muted: "border-foreground/20 border-t-foreground/60",
  /** For placement on a solid foreground surface (e.g. a primary button). */
  inverted: "border-background/40 border-t-background",
} as const;

interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof SIZES;
  tone?: keyof typeof TONES;
}

export function Spinner({ size = "md", tone = "default", ...rest }: SpinnerProps) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 ${SIZES[size]} ${TONES[tone]}`}
      {...rest}
    />
  );
}

/**
 * The standard in-content page spinner: vertically centered in the viewport
 * minus the header, leaving the app chrome visible (unlike FullScreenSpinner,
 * which covers everything during startup).
 */
export function CenteredSpinner() {
  return (
    <div className="flex min-h-[calc(100dvh-10rem)] items-center justify-center">
      <Spinner />
    </div>
  );
}
