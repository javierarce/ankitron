import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { compareDeckPaths, deckLeaf, deckParent, formatDeckPath } from "@/lib/deck";
import { foldText } from "@/lib/fold-text";
import { useMenuPlacement } from "@/hooks/use-menu-placement";

interface DeckFilterProps {
  /** All deck names (full "::" paths); null while they load. */
  decks: string[] | null;
  /** Selected deck path, or "" for the everything option. */
  value: string;
  onChange: (deck: string) => void;
  /** Label for the "no filter" option. */
  allLabel?: string;
  /** Accessible name for the trigger. */
  label: string;
}

/**
 * A type-to-search deck filter for page headers.
 *
 * Distinct from DeckPicker, which is an always-open tree browser for dialogs
 * where choosing a deck IS the task (and which can create decks). This is the
 * compact counterpart: a trigger showing the current scope, and a popover with
 * a search field over a flat, full-path list. A collection with dozens of decks
 * makes a native <select> unusable — you can't see the hierarchy, can't type
 * more than a leading character, and scan a scrolling list of look-alike leaf
 * names — whereas search finds a deck in a couple of keystrokes regardless of
 * how deep it's nested.
 *
 * Like ActionsMenu, it deliberately does NOT take the app's scroll lock: that's
 * for real dialogs, and global single-key shortcut handlers check
 * isScrollLocked() and must keep firing while a transient popover is open.
 */
export function DeckFilter({
  decks,
  value,
  onChange,
  allLabel = "All decks",
  label,
}: DeckFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const style = useMenuPlacement(open, triggerRef, popoverRef);

  // "" (everything) is always offered and always first, so clearing the filter
  // is one keystroke away no matter what's typed.
  const options = useMemo(() => {
    const all = [...(decks ?? [])].sort(compareDeckPaths);
    const q = foldText(query.trim());
    const matches = q ? all.filter((d) => foldText(d).includes(q)) : all;
    return q && !foldText(allLabel).includes(q) ? matches : ["", ...matches];
  }, [decks, query, allLabel]);

  // Keep the highlight in range as the query narrows the list.
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Follow the highlight with the scroll position, so keyboard navigation
  // doesn't run off the bottom of a long list.
  useEffect(() => {
    if (!open) return;
    // Optional call: jsdom doesn't implement scrollIntoView, same guard as
    // DeckPicker's focus-on-open.
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  function openWith() {
    setQuery("");
    // Start on the current selection so the list opens where the user left off.
    const i = (decks ?? []).length ? Math.max(0, indexOfValue()) : 0;
    setActive(i);
    setOpen(true);
  }

  function indexOfValue(): number {
    const all = [...(decks ?? [])].sort(compareDeckPaths);
    return value === "" ? 0 : all.indexOf(value) + 1;
  }

  function commit(deck: string) {
    onChange(deck);
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (options.length > 0) commit(options[activeIndex]);
    } else if (e.key === "Escape") {
      // Escape clears a query before it closes the popover, so a mistyped
      // search doesn't cost the whole interaction.
      e.stopPropagation();
      if (query) setQuery("");
      else {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
  }

  const listboxId = "deck-filter-listbox";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openWith())}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-56 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm transition-colors hover:bg-foreground/5"
      >
        {/* The ancestors truncate, the leaf never does. Plain `truncate` on the
            whole path would clip from the end and eat the deck's actual name —
            "German / Survival / Are you cra…" — which is the one part the user
            needs to read back. */}
        {value ? (
          <span className="flex min-w-0 items-baseline">
            {deckParent(value) && (
              <span className="truncate text-foreground/40">
                {formatDeckPath(deckParent(value))} /&nbsp;
              </span>
            )}
            <span className="shrink-0">{deckLeaf(value)}</span>
          </span>
        ) : (
          <span className="truncate">{allLabel}</span>
        )}
        <CaretDown size={12} weight="bold" className="shrink-0 text-foreground/40" />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            style={style}
            className="z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg"
          >
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search decks…"
              aria-label="Search decks"
              role="combobox"
              aria-controls={listboxId}
              aria-expanded
              aria-autocomplete="list"
              aria-activedescendant={
                options.length ? `deck-filter-option-${activeIndex}` : undefined
              }
              spellCheck={false}
              autoFocus
              className="shrink-0 border-b border-border bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:outline-none"
            />
            <div
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="max-h-64 overflow-y-auto py-1"
            >
              {decks === null ? (
                <p className="px-3 py-1.5 text-sm text-foreground/50">
                  Loading decks…
                </p>
              ) : options.length === 0 ? (
                <p className="px-3 py-1.5 text-sm text-foreground/50">
                  No decks match “{query.trim()}”.
                </p>
              ) : (
                options.map((deck, i) => (
                  <Option
                    key={deck || "__all__"}
                    deck={deck}
                    index={i}
                    allLabel={allLabel}
                    selected={deck === value}
                    active={i === activeIndex}
                    onSelect={() => commit(deck)}
                    onHover={() => setActive(i)}
                  />
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Option({
  deck,
  index,
  allLabel,
  selected,
  active,
  onSelect,
  onHover,
}: {
  deck: string;
  index: number;
  allLabel: string;
  selected: boolean;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  const parent = deck ? deckParent(deck) : "";
  return (
    <button
      type="button"
      id={`deck-filter-option-${index}`}
      data-index={index}
      role="option"
      aria-selected={selected}
      // mousedown would fire before the input's blur and fight the outside-click
      // handler; click is enough because the popover stays open until commit.
      onClick={onSelect}
      onMouseMove={onHover}
      className={`flex w-full min-w-0 items-center gap-1.5 px-3 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-foreground/5" : ""
      } ${selected ? "font-medium" : ""}`}
    >
      <span className="truncate">
        {deck ? (
          <>
            {/* Dim the ancestors so the leaf — the part the user is scanning
                for — reads first, matching the decks page search results. */}
            {parent && (
              <span className="text-foreground/40">
                {formatDeckPath(parent)} /{" "}
              </span>
            )}
            {deckLeaf(deck)}
          </>
        ) : (
          allLabel
        )}
      </span>
      {selected && <Check size={14} weight="bold" className="ml-auto shrink-0" />}
    </button>
  );
}
