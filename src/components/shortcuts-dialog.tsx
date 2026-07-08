import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Keyboard } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { isScrollLocked, useScrollLock } from "@/hooks/use-scroll-lock";

/** A single key rendered as a small GitHub-style pill. */
type Combo = {
  /** Keys pressed together, joined by "+" (or a plain gap when `seq`). */
  keys: string[];
  /** True when the keys are pressed in sequence (e.g. g g), not chorded. */
  seq?: boolean;
};

type Shortcut = {
  /** Alternative key combos, shown joined by "/". */
  combos: Combo[];
  desc: string;
};

type Section = { title: string; shortcuts: Shortcut[] };

// Kept deliberately lean: the command palette's own navigation isn't listed
// (only how to invoke it), and the general list-navigation keys live in Global
// rather than being repeated per page. This is the single source of truth for
// the app's shortcut list.
const SECTIONS: Section[] = [
  {
    title: "Global",
    shortcuts: [
      { combos: [{ keys: ["Cmd", "K"] }], desc: "Open the command palette" },
      { combos: [{ keys: ["Cmd", "N"] }], desc: "New note" },
      { combos: [{ keys: ["Cmd", ","] }], desc: "Open settings" },
      { combos: [{ keys: ["Cmd", "S"] }], desc: "Go to Study" },
      { combos: [{ keys: ["Cmd", "D"] }], desc: "Go to Decks" },
      { combos: [{ keys: ["?"] }], desc: "Show keyboard shortcuts" },
      { combos: [{ keys: ["j"] }, { keys: ["↓"] }], desc: "Move down a list" },
      { combos: [{ keys: ["k"] }, { keys: ["↑"] }], desc: "Move up a list" },
      {
        combos: [{ keys: ["l"] }, { keys: ["→"] }],
        desc: "Expand the focused deck",
      },
      {
        combos: [{ keys: ["h"] }, { keys: ["←"] }],
        desc: "Collapse the focused deck, or jump to its parent",
      },
    ],
  },
  {
    title: "Note list",
    shortcuts: [
      { combos: [{ keys: ["Cmd", "A"] }], desc: "Select all notes" },
      { combos: [{ keys: ["Space"] }], desc: "Toggle selection of the focused note" },
      { combos: [{ keys: ["a"] }], desc: "Add a new note" },
      { combos: [{ keys: ["e"] }], desc: "Edit the selected notes" },
      { combos: [{ keys: ["t"] }], desc: "Add or remove tags" },
      { combos: [{ keys: ["s"] }], desc: "Suspend or unsuspend" },
      { combos: [{ keys: ["Cmd", "1–7"] }], desc: "Flag (Cmd 0 clears)" },
      { combos: [{ keys: ["m"] }], desc: "Move to another deck" },
      { combos: [{ keys: ["Cmd", "Z"] }], desc: "Undo the last tag change" },
    ],
  },
  {
    title: "Study session",
    shortcuts: [
      {
        combos: [{ keys: ["Space"] }, { keys: ["1"] }, { keys: ["2"] }],
        desc: "Reveal the answer",
      },
      { combos: [{ keys: ["1"] }], desc: "Grade Fail" },
      {
        combos: [{ keys: ["Space"] }, { keys: ["2"] }],
        desc: "Grade Pass",
      },
      { combos: [{ keys: ["r"] }], desc: "Play the card's audio" },
      { combos: [{ keys: ["e"] }], desc: "Edit the current note" },
      { combos: [{ keys: ["s"] }], desc: "Suspend the current note" },
      { combos: [{ keys: ["Cmd", "1–7"] }], desc: "Flag the card (again to clear)" },
      { combos: [{ keys: ["Cmd", "0"] }], desc: "Clear the flag" },
      { combos: [{ keys: ["a"] }], desc: "Add a note to the session" },
      { combos: [{ keys: ["Cmd", "←"] }], desc: "Return to the deck" },
      { combos: [{ keys: ["Cmd", "Z"] }], desc: "Undo the last review" },
    ],
  },
];

/** A GitHub-style key pill. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-foreground/[0.04] px-1.5 font-mono text-[11px] leading-none text-foreground shadow-[inset_0_-1px_0_var(--border)]">
      {children}
    </kbd>
  );
}

function Keys({ combos }: { combos: Combo[] }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {combos.map((combo, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-xs text-foreground/40">/</span>}
          <span className="inline-flex items-center gap-1">
            {combo.keys.map((key, j) => (
              <Fragment key={j}>
                {j > 0 && !combo.seq && (
                  <span className="text-xs text-foreground/40">+</span>
                )}
                <Kbd>{key}</Kbd>
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Header button that opens a dialog listing the app's keyboard shortcuts.
 * Self-contained (owns its open state) so it drops in next to the settings cog.
 */
export function ShortcutsButton() {
  const [open, setOpen] = useState(false);

  // "?" opens the shortcuts dialog from anywhere, but not when a modal/editor is
  // open (isScrollLocked covers the import, confirm, editor, palette… dialogs)
  // or a text field is focused. A transient dropdown (ellipsis row menu) is not
  // a dialog, so it's allowed to open the list — the menu dismisses along with
  // the shortcuts dialog on Esc / outside-click. The field guard mirrors
  // use-vim-nav / card-list.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isScrollLocked()) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable)
        return;
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
        className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <Keyboard size={16} weight="regular" />
      </button>
      {open && <ShortcutsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useScrollLock();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Portal to <body>: rendered inline, the dialog sits inside the sticky, z-40
  // header, whose stacking context traps its z-[100] below page overlays like
  // the card editor and the portal-rendered row menus (both z-50). At the body
  // root it stacks above everything, as a top-level modal should.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg">
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold">Keyboard shortcuts</h3>
        </div>
        <div className="overflow-y-auto px-6 py-4">
          {SECTIONS.map((section) => (
            <section key={section.title} className="mb-6 last:mb-0">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground/40">
                {section.title}
              </h4>
              <ul>
                {section.shortcuts.map((shortcut, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-4 py-1.5"
                  >
                    <span className="text-sm text-foreground/70">
                      {shortcut.desc}
                    </span>
                    <span className="shrink-0">
                      <Keys combos={shortcut.combos} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
