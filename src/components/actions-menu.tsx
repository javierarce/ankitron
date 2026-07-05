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
  label: ReactNode;
  /** Keyboard hint rendered right-aligned next to the label. */
  kbd?: string;
  /** Destructive items (Delete) render red. */
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip — e.g. the reason a disabled item can't be used. */
  title?: string;
  onSelect: () => void;
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
}: {
  /** Accessible name for the trigger ("Note actions", "Deck actions", …). */
  label: string;
  items: ActionsMenuItem[];
  /** Extra popup classes, e.g. a min-width. */
  menuClassName?: string;
  /** Replaces the default trigger styling; the function form sees open state. */
  triggerClassName?: string | ((open: boolean) => string);
  iconSize?: number;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const style = useMenuPlacement(open, btnRef, menuRef);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          typeof triggerClassName === "function"
            ? triggerClassName(open)
            : (triggerClassName ?? TRIGGER_CLASS)
        }
      >
        <DotsThreeVertical size={iconSize} weight="bold" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={style}
            className={`z-50 flex w-max flex-col overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg${
              menuClassName ? ` ${menuClassName}` : ""
            }`}
          >
            {items.map((item, i) => (
              <button
                key={i}
                disabled={item.disabled}
                title={item.title}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
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
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
