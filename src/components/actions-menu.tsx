import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical";
import { useMenuPlacement } from "@/hooks/use-menu-placement";

// A muted keyboard hint shown next to an action's label, so the single-key
// shortcuts (e/s/m/t) are discoverable from the controls that trigger them.
export function Kbd({ children }: { children: string }) {
  return (
    // The hint font is smaller than the label it sits beside; flex centering
    // lands its tight line box a hair high, so nudge it down a pixel to line up
    // optically with the text baseline.
    <kbd className="relative top-px font-sans text-[11px] leading-none text-foreground/30">
      {children}
    </kbd>
  );
}

export interface ActionsMenuItem {
  label?: ReactNode;
  /** Keyboard hint rendered right-aligned next to the label. */
  kbd?: string;
  /** Destructive items (Delete) render red. */
  danger?: boolean;
  /**
   * Ask before running. The popup swaps its list for this question in place,
   * rather than opening a dialog — which matters most where the menu is itself
   * inside a modal, and a confirmation would otherwise be a second modal on top
   * of the first. Cancel returns to the list; confirming runs onSelect.
   */
  confirm?: {
    message: string;
    /** The confirming button's label, e.g. "Delete". */
    confirmLabel: string;
  };
  /**
   * Like `confirm`, but the item supplies the whole panel — for a step that
   * needs real UI rather than a yes/no (choosing a deck to move to). Gets
   * `close` to dismiss the popup once it's done. Takes precedence over
   * `confirm`, and `onSelect` is ignored: the panel owns its own actions.
   */
  panel?: (close: () => void) => ReactNode;
  disabled?: boolean;
  /** Tooltip — e.g. the reason a disabled item can't be used. */
  title?: string;
  onSelect?: () => void;
  /**
   * Render arbitrary content in place of a plain button (e.g. the flag colour
   * grid). Gets `close` so the content can dismiss the menu after acting —
   * a custom item owns its own click handling, so `onSelect` is ignored.
   */
  render?: (close: () => void) => ReactNode;
}

const TRIGGER_CLASS =
  "shrink-0 rounded-md p-1 text-foreground/30 transition-all hover:bg-foreground/5 hover:text-foreground/60";

function itemClassName({ kbd, danger }: ActionsMenuItem): string {
  return [
    // The label/kbd pair splits to the row's edges; a plain label needs no flex.
    kbd !== undefined ? "flex w-full items-center justify-between gap-6" : "w-full",
    "px-3 py-1.5 text-left text-sm transition-colors hover:bg-foreground/5",
    danger ? "text-red-500" : "text-foreground/70",
    "disabled:cursor-not-allowed disabled:text-foreground/30 disabled:hover:bg-transparent",
  ].join(" ");
}

/**
 * The kebab ("⋮") actions menu used on note rows, deck rows, and the study
 * card. Renders its popup in a portal (escaping any overflow-hidden ancestor)
 * at flip-aware fixed coordinates via useMenuPlacement, so a menu near the
 * bottom of a list opens upward instead of being cut off.
 *
 * Open/close state is local, and deliberately does NOT take the app's scroll
 * lock — that's for real dialogs; global single-key shortcut handlers check
 * isScrollLocked() and must keep firing while a row menu is open.
 *
 * Clicks inside the popup bubble through the React tree (portals propagate
 * synthetic events to their React parent, not their DOM parent), so a call
 * site inside a clickable row must stop propagation on a wrapper around this
 * component.
 */
export function ActionsMenu({
  label,
  items,
  menuClassName,
  triggerClassName,
  iconSize = 22,
  triggerContent,
}: {
  /** Accessible name for the trigger ("Note actions", "Deck actions", …). */
  label: string;
  items: ActionsMenuItem[];
  /** Extra popup classes, e.g. a min-width. */
  menuClassName?: string;
  /** Replaces the default trigger styling; the function form sees open state. */
  triggerClassName?: string | ((open: boolean) => string);
  iconSize?: number;
  /** Replaces the default kebab glyph inside the trigger (e.g. a labelled button). */
  triggerContent?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Index of the item whose confirmation is showing in place of the list.
  const [confirming, setConfirming] = useState<number | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The confirmation is a different size from the list, so placement has to be
  // taken again — a menu that opened upward is anchored by its bottom edge.
  const style = useMenuPlacement(open, btnRef, menuRef, { remeasure: confirming });

  function close() {
    setOpen(false);
    setConfirming(null);
  }

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Consume it. This menu opens inside ModalDialog, which closes the whole
      // dialog on Escape from BOTH a window listener and its panel's onKeyDown
      // — and React's root handler runs before any window bubble listener, so
      // a bubble-phase listener here would never get there first. Left alone,
      // backing out of a confirmation would take the user's unsaved edits with
      // it, or end a whole sequence run. Hence capture phase + stopPropagation:
      // Escape unwinds one step at a time, innermost first.
      e.stopPropagation();
      if (confirming !== null) setConfirming(null);
      else setOpen(false);
    }
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey, true);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey, true);
    };
  }, [open, confirming]);

  return (
    <>
      <button
        // Never a submit button: this menu is used inside a <form> (the card
        // editor's footer), where the default type would save and advance
        // instead of opening the menu.
        type="button"
        ref={btnRef}
        onClick={() => (open ? close() : setOpen(true))}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          typeof triggerClassName === "function"
            ? triggerClassName(open)
            : (triggerClassName ?? TRIGGER_CLASS)
        }
      >
        {triggerContent ?? <DotsThreeVertical size={iconSize} weight="bold" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role={confirming === null ? "menu" : "dialog"}
            aria-label={confirming === null ? undefined : label}
            style={style}
            className={`z-50 flex w-max flex-col overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg${
              menuClassName ? ` ${menuClassName}` : ""
            }`}
          >
            {confirming !== null && items[confirming]?.panel ? (
              items[confirming].panel(close)
            ) : confirming !== null && items[confirming]?.confirm ? (
              <div className="flex w-60 flex-col gap-3 px-3 py-2">
                <p className="text-sm text-foreground/70">
                  {items[confirming].confirm.message}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-lg px-2.5 py-1.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const item = items[confirming];
                      close();
                      item.onSelect?.();
                    }}
                    className={`rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                      items[confirming].danger
                        ? "border-red-500/30 text-red-500 hover:bg-red-500/10"
                        : "border-border hover:bg-foreground/5"
                    }`}
                  >
                    {items[confirming].confirm.confirmLabel}
                  </button>
                </div>
              </div>
            ) : (
            items.map((item, i) =>
              item.render ? (
                <div key={i} role="none">
                  {item.render(() => setOpen(false))}
                </div>
              ) : (
                <button
                  key={i}
                  type="button"
                  disabled={item.disabled}
                  title={item.title}
                  onClick={() => {
                    // An item that asks first — a question or a whole panel —
                    // swaps the popup instead of running and dismissing.
                    if (item.confirm || item.panel) {
                      setConfirming(i);
                      return;
                    }
                    close();
                    item.onSelect?.();
                  }}
                  className={itemClassName(item)}
                >
                  {item.kbd !== undefined ? (
                    <>
                      <span>{item.label}</span>
                      <Kbd>{item.kbd}</Kbd>
                    </>
                  ) : (
                    item.label
                  )}
                </button>
              ),
            )
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
