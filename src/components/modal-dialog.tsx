import { isValidElement, useEffect, useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { useScrollLock } from "@/hooks/use-scroll-lock";

// The panel widths dialogs actually use: sm for the confirm dialog, md for the
// standard single-purpose dialogs, 2xl for the big editors (card form, import
// preview).
const WIDTH_CLASS = {
  sm: "max-w-sm",
  md: "max-w-md",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
} as const;

// Everything the Tab trap can land on. The union of the selectors the per-
// dialog traps used (card-form's, which included contenteditable for the
// ProseMirror editors, was the broadest).
const FOCUSABLE_SELECTOR =
  'button:not([disabled]):not([tabindex="-1"]), ' +
  'input:not([disabled]):not([tabindex="-1"]), ' +
  'select:not([disabled]):not([tabindex="-1"]), ' +
  'textarea:not([disabled]):not([tabindex="-1"]), ' +
  '[contenteditable="true"]:not([tabindex="-1"]), ' +
  '[tabindex]:not([tabindex="-1"])';

/**
 * The standard Cancel + confirm footer most dialogs share. Dialogs with a
 * different shape (extra buttons, submit buttons inside a form) pass a
 * ReactNode footer or render their own inside `children` instead.
 */
export interface ModalFooterConfig {
  /** Label for the ghost cancel button (which calls `onClose`). */
  cancelLabel?: string;
  confirmLabel: string;
  /** Confirm-button label shown while `busy` (e.g. "Moving…"). */
  busyLabel?: string;
  /** Style the confirm button as destructive (red) instead of the default. */
  confirmDanger?: boolean;
  /** Disable the confirm button beyond `busy` (e.g. nothing selected yet). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
}

interface ModalDialogProps {
  /** Rendered as the dialog's <h3> heading and used as its accessible name. */
  title?: ReactNode;
  /**
   * Margin class(es) under the title — dialogs differ (mb-1 when a subtitle
   * follows, up to the default mb-4 before plain content).
   */
  titleClassName?: string;
  /**
   * Accessible name for dialogs that render a custom header inside `children`
   * instead of passing `title`.
   */
  ariaLabel?: string;
  /**
   * An operation is in flight: Escape and backdrop clicks won't dismiss, and
   * the convenience footer's buttons are disabled.
   */
  busy?: boolean;
  /**
   * A dialog is stacked on top (e.g. a delete confirmation over the card
   * form): ignore Escape and backdrop clicks, and let keys bubble so the
   * stacked dialog's own handlers see them.
   */
  blocked?: boolean;
  onClose: () => void;
  width?: keyof typeof WIDTH_CLASS;
  /**
   * Vertical placement of the panel: "center" (default) or "start", which
   * pins it near the top (pt-[15vh]) — for palette-style dialogs.
   */
  align?: "center" | "start";
  /**
   * Drop the default p-6 and clip content to the rounded corners: for dialogs
   * that render their own edge-to-edge chrome (e.g. the command palette's
   * full-width search / list / footer sections).
   */
  unpadded?: boolean;
  /** Cap the panel at 90vh and scroll its content (the big editors). */
  scrollable?: boolean;
  footer?: ModalFooterConfig | ReactNode;
  /** The panel element, for content that manages focus itself. */
  panelRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

function isFooterConfig(
  footer: ModalFooterConfig | ReactNode,
): footer is ModalFooterConfig {
  return (
    typeof footer === "object" &&
    footer !== null &&
    !isValidElement(footer) &&
    "onConfirm" in footer
  );
}

/**
 * The shared modal shell: dimmed backdrop with click-outside dismiss, Escape
 * to close, body scroll lock (which is also how global shortcut handlers know
 * a dialog is open — see isScrollLocked), a Tab trap, and dialog ARIA.
 *
 * Portals to <body>: rendered inline a dialog can end up inside the sticky
 * z-40 header's stacking context (trapped under page overlays) or inside a
 * form (where Enter in a field would submit it). At the body root it stacks
 * and behaves like a top-level modal everywhere.
 */
export function ModalDialog({
  title,
  titleClassName = "mb-4",
  ariaLabel,
  busy = false,
  blocked = false,
  onClose,
  width = "md",
  align = "center",
  unpadded = false,
  scrollable = false,
  footer,
  panelRef,
  children,
}: ModalDialogProps) {
  useScrollLock();
  const titleId = useId();
  const innerPanelRef = useRef<HTMLDivElement | null>(null);

  // Escape pressed while focus is outside the dialog (the panel's own keydown
  // handler below never sees those). Suppressed while busy — an in-flight
  // operation shouldn't lose its dialog — and while a stacked dialog owns
  // dismissal.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy && !blocked) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, blocked, onClose]);

  // Park focus on the panel when nothing inside the dialog grabbed it (many
  // dialogs autofocus a field; this covers the ones that don't), so keystrokes
  // hit the dialog's handlers and the Tab trap instead of the page behind it.
  useEffect(() => {
    const panel = innerPanelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    if (!active || !panel.contains(active)) panel.focus();
  }, []);

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-black/50 ${
        align === "start" ? "items-start pt-[15vh]" : "items-center"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && !blocked) onClose();
      }}
      // Keys pressed inside the dialog stay in the dialog: without the
      // stopPropagation they'd bubble across the portal to ancestor handlers
      // (e.g. a form's Cmd+Enter = save behind a stacked dialog). Escape is
      // handled here as well, because that same stopPropagation keeps events
      // from ever reaching the window listener above. When a stacked dialog
      // owns dismissal (`blocked`), let everything bubble so its window-level
      // Escape handler still fires.
      onKeyDown={(e) => {
        if (!blocked) {
          e.stopPropagation();
          if (e.key === "Escape") {
            if (!busy) onClose();
            return;
          }
        }
        // Trap Tab inside the panel — the portal sits outside any focus
        // scope the opener had, so without this Tab would land on controls
        // behind the backdrop.
        if (e.key !== "Tab") return;
        const panel = innerPanelRef.current;
        if (!panel) return;
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !panel.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      <div
        ref={(el) => {
          innerPanelRef.current = el;
          if (panelRef) panelRef.current = el;
        }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        aria-label={title === undefined ? ariaLabel : undefined}
        className={`mx-4 w-full ${WIDTH_CLASS[width]} ${
          scrollable ? "max-h-[90vh] overflow-y-auto " : ""
        }${
          unpadded ? "overflow-hidden " : "p-6 "
        }rounded-xl border border-border bg-background shadow-lg focus:outline-none`}
      >
        {title !== undefined && (
          <h3 id={titleId} className={`${titleClassName} text-lg font-semibold`}>
            {title}
          </h3>
        )}
        {children}
        {footer !== undefined &&
          (isFooterConfig(footer) ? (
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground"
              >
                {footer.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                onClick={footer.onConfirm}
                disabled={busy || footer.confirmDisabled}
                className={
                  footer.confirmDanger
                    ? "rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
                    : "rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
                }
              >
                {busy ? (footer.busyLabel ?? footer.confirmLabel) : footer.confirmLabel}
              </button>
            </div>
          ) : (
            footer
          ))}
      </div>
    </div>,
    document.body,
  );
}
