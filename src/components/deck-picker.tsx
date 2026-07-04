import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import {
  buildDeckTree,
  compareDeckPaths,
  deckLeaf,
  deckParent,
  formatDeckPath,
  joinDeck,
  type DeckNode,
} from "@/lib/deck";
import { foldText } from "@/lib/fold-text";

interface DeckPickerProps {
  /** All existing deck names (full "::" paths); null while they load. */
  decks: string[] | null;
  /** Selected deck path; "" selects "Top level" when allowTopLevel. null = none. */
  value: string | null;
  /**
   * Selection changed. `isNew` means the deck doesn't exist yet (the user typed
   * it via a "new deck" affordance) and the caller must createDeck it on
   * confirm — the picker itself never writes to Anki.
   */
  onChange: (deck: string, isNew: boolean) => void;
  /** Why a deck can't be chosen (shown as a tooltip). Null/undefined = pickable. */
  disable?: (deck: string) => string | null;
  /** Offer a selectable "Top level (no parent)" row, reported as "". */
  allowTopLevel?: boolean;
  /** Offer a "new subdeck" button on the selected row plus a "new top-level deck" button. */
  allowCreate?: boolean;
  /**
   * Whether allowCreate includes the "new top-level deck" button (default yes).
   * Set false when the surrounding UI already has its own new-deck entry point
   * (e.g. the import dialog's "New deck" option) so the two don't compete.
   */
  allowCreateTopLevel?: boolean;
  /** Gray out the whole picker while the surrounding dialog is working. */
  disabled?: boolean;
  /** Focus the selected (or first) row once the decks load. */
  autoFocus?: boolean;
}

// Show the filter field only when the list is long enough for scanning to hurt;
// for a handful of decks it would just push the tree down.
const FILTER_THRESHOLD = 7;

/**
 * An inline tree browser for choosing a deck inside a dialog: expandable
 * hierarchy, filtering, keyboard navigation, and (optionally) creating a new
 * deck under any parent without exposing the "::" path syntax. Replaces the
 * flat native <select>s that faked the tree with indented option labels.
 */
export function DeckPicker({
  decks,
  value,
  onChange,
  disable,
  allowTopLevel = false,
  allowCreate = false,
  allowCreateTopLevel = true,
  disabled = false,
  autoFocus = false,
}: DeckPickerProps) {
  // Track collapsed (not expanded) nodes so the tree starts fully expanded —
  // a picker's job is to reach any deck, so hiding branches by default would
  // just add clicks. Collapse remains available for pruning big trees.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // The one path the user typed via "new deck" that doesn't exist in Anki yet.
  // It renders as an ordinary row (badged "new") so the pending choice looks
  // like the tree it will become — but it's speculative: selecting anything
  // else (or drafting a replacement) discards it, so changing your mind never
  // leaves a trail of phantom decks.
  const [draft, setDraft] = useState<string | null>(null);
  // Parent path of the draft row currently being typed; null = no input open.
  const [draftParent, setDraftParent] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const treeRef = useRef<HTMLDivElement>(null);
  const draftRowRef = useRef<HTMLDivElement>(null);

  const realSet = useMemo(() => new Set(decks ?? []), [decks]);

  // The rendered set: real decks, the pending draft, and the controlled value
  // itself (a safety net so a selected deck always has a row, even if a caller
  // passes one the picker didn't create).
  const allDecks = useMemo(() => {
    const s = new Set(decks ?? []);
    if (draft) s.add(draft);
    if (value) s.add(value);
    return [...s];
  }, [decks, draft, value]);

  const tree = useMemo(() => buildDeckTree(allDecks), [allDecks]);

  const q = foldText(query.trim());
  // While filtering, show flat matches with their full path — the tree view
  // would hide matches under collapsed or non-matching parents.
  const matches = q
    ? allDecks.filter((d) => foldText(d).includes(q)).sort(compareDeckPaths)
    : null;

  // Roving tabindex target: the selected row when it's actually visible, else
  // the first enabled visible row — the picker must keep exactly one Tab stop
  // even when a filter query or a collapsed branch hides the selection.
  const visibleRows = (() => {
    if (matches) return matches;
    const flat: string[] = [];
    const walk = (nodes: DeckNode[]) => {
      for (const n of nodes) {
        flat.push(n.fullName);
        if (!collapsed.has(n.fullName)) walk(n.children);
      }
    };
    walk(tree);
    return allowTopLevel ? ["", ...flat] : flat;
  })();
  const tabStop =
    value !== null && visibleRows.includes(value)
      ? value
      : visibleRows.find((d) => d === "" || !disable?.(d));
  function rowTabIndex(deck: string): number {
    return deck === tabStop ? 0 : -1;
  }

  function select(deck: string) {
    // Moving the selection off the pending draft abandons it.
    if (draft !== null && deck !== draft) setDraft(null);
    onChange(deck, deck !== "" && !realSet.has(deck));
  }

  function toggle(deck: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(deck)) next.delete(deck);
      else next.add(deck);
      return next;
    });
  }

  function startDraft(parent: string) {
    setDraftParent(parent);
    setDraftName("");
    setDraftError(null);
    if (parent) {
      // The input renders as a child row, so the parent must be open.
      setCollapsed((prev) => {
        if (!prev.has(parent)) return prev;
        const next = new Set(prev);
        next.delete(parent);
        return next;
      });
    }
  }

  function cancelDraft() {
    setDraftParent(null);
    setDraftName("");
    setDraftError(null);
  }

  function commitDraft() {
    if (draftParent === null) return;
    const name = draftName.trim();
    if (!name) {
      cancelDraft();
      return;
    }
    const path = joinDeck(draftParent, name);
    const reason = disable?.(path);
    if (reason) {
      setDraftError(reason);
      return;
    }
    // Typing the name of an existing deck just selects it — createDeck would
    // dedupe anyway, so don't pretend a duplicate draft is new. A genuinely
    // new path replaces any earlier draft rather than piling up next to it.
    setDraft(realSet.has(path) ? null : path);
    onChange(path, !realSet.has(path));
    cancelDraft();
  }

  // Commit (or cancel, when empty) the open draft on any pointer press outside
  // its input — the input's own blur can't be relied on for this: pressing the
  // dialog's confirm button while it's disabled (as it is until the draft
  // commits) doesn't move focus, so blur never fires and the click feels dead.
  // Pointer events, unlike mouse/click, are dispatched even for disabled
  // targets, and the capture phase sees them regardless of the target.
  const flushDraftRef = useRef<() => void>(() => {});
  useEffect(() => {
    flushDraftRef.current = () => {
      if (draftName.trim()) commitDraft();
      else cancelDraft();
    };
  });
  useEffect(() => {
    if (draftParent === null) return;
    function onPointerDown(e: PointerEvent) {
      if (draftRowRef.current?.contains(e.target as Node)) return;
      flushDraftRef.current();
    }
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [draftParent]);

  // Focus/scroll the selected (else first) row once when the decks arrive.
  const didFocus = useRef(false);
  useEffect(() => {
    if (didFocus.current || decks === null) return;
    didFocus.current = true;
    const rows = rowButtons(treeRef.current);
    const target = rows.find((r) => r.dataset.selected === "true") ?? rows[0];
    if (!target) return;
    target.scrollIntoView?.({ block: "nearest" });
    if (autoFocus) target.focus();
  }, [decks, autoFocus]);

  // Roving arrow-key navigation over the visible rows. Rows are plain buttons,
  // so Tab/Enter/Space already work; arrows add the up/down/expand/collapse
  // movement the native <select> used to provide.
  function onTreeKeyDown(e: React.KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const rows = rowButtons(treeRef.current);
    if (rows.length === 0) return;
    const active = document.activeElement as HTMLButtonElement | null;
    const idx = active ? rows.indexOf(active) : -1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      rows[Math.min(idx + 1, rows.length - 1)].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      rows[Math.max(idx - 1, 0)].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      rows[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      rows[rows.length - 1].focus();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const deck = active?.dataset.deck;
      if (deck === undefined || deck === "" || matches) return;
      e.preventDefault();
      const isCollapsed = collapsed.has(deck);
      if (e.key === "ArrowRight" && isCollapsed) toggle(deck);
      if (e.key === "ArrowLeft" && !isCollapsed) toggle(deck);
    }
  }

  function renderRow(deck: string, depth: number, node?: DeckNode) {
    const isVirtual = deck !== "" && !realSet.has(deck);
    const reason = deck === "" ? null : (disable?.(deck) ?? null);
    const isSelected = value === deck;
    const leafName = deck === "" ? "Top level (no parent)" : deckLeaf(deck);
    const hasChildren = (node?.children.length ?? 0) > 0;
    const isOpen = !collapsed.has(deck);

    return (
      <div
        className="flex items-center gap-0.5 pr-1"
        style={{ paddingLeft: 4 + depth * 18 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggle(deck)}
            disabled={disabled}
            tabIndex={-1}
            aria-label={isOpen ? "Collapse" : "Expand"}
            aria-expanded={isOpen}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground/70"
          >
            {isOpen ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          data-picker-row
          data-deck={deck}
          data-selected={isSelected || undefined}
          onClick={() => select(deck)}
          disabled={disabled || reason !== null}
          tabIndex={rowTabIndex(deck)}
          title={reason ?? (deck ? formatDeckPath(deck) : undefined)}
          aria-pressed={isSelected}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
            isSelected
              ? "bg-foreground/10 font-medium"
              : reason !== null
                ? "cursor-not-allowed text-foreground/30"
                : "hover:bg-foreground/5"
          }`}
        >
          <span className={`truncate ${deck === "" ? "text-foreground/70" : ""}`}>
            {leafName}
          </span>
          {/* The explicit space keeps the accessible name "X new", not "Xnew". */}
          {isVirtual && <>{" "}<NewBadge /></>}
          {isSelected && <Check size={14} weight="bold" className="ml-auto shrink-0" />}
        </button>
        {/* Subdeck creation hangs off the selected row only: no hover-reveal
            (which can strand a stale "+" on screen), and pending "new" decks
            don't offer it — nesting under a deck that doesn't exist yet is
            never what the user wants mid-dialog. */}
        {allowCreate && isSelected && deck !== "" && !isVirtual && !disabled && (
          <button
            type="button"
            onClick={() => startDraft(deck)}
            title={`New subdeck of ${formatDeckPath(deck)}`}
            aria-label={`New subdeck of ${formatDeckPath(deck)}`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground/70"
          >
            <Plus size={12} weight="bold" />
          </button>
        )}
      </div>
    );
  }

  function renderDraftInput(depth: number) {
    return (
      <div
        ref={draftRowRef}
        className="py-0.5 pr-1"
        style={{ paddingLeft: 4 + depth * 18 + 22 }}
      >
        <input
          type="text"
          value={draftName}
          onChange={(e) => {
            setDraftName(e.target.value);
            setDraftError(null);
          }}
          onKeyDown={(e) => {
            // Keep Enter/Escape inside the picker: Enter must not submit the
            // dialog with a half-typed target, and Escape must not close it.
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              commitDraft();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              cancelDraft();
            }
          }}
          onBlur={() => {
            // Keep the typed name when focus moves to the dialog's confirm
            // button; an empty input just closes.
            if (draftName.trim()) commitDraft();
            else cancelDraft();
          }}
          placeholder="New deck name"
          spellCheck={false}
          autoFocus
          className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-sm placeholder:text-foreground/40 focus:border-foreground/40 focus:outline-none"
        />
        {draftError && <p className="mt-1 text-xs text-red-500">{draftError}</p>}
      </div>
    );
  }

  function renderTree(node: DeckNode, depth: number): React.ReactNode {
    const isOpen = !collapsed.has(node.fullName);
    return (
      <Fragment key={node.fullName}>
        {renderRow(node.fullName, depth, node)}
        {isOpen && node.children.map((child) => renderTree(child, depth + 1))}
        {isOpen && draftParent === node.fullName && renderDraftInput(depth + 1)}
      </Fragment>
    );
  }

  const showFilter = decks !== null && decks.length >= FILTER_THRESHOLD;

  return (
    <div className={disabled ? "opacity-60" : undefined}>
      {showFilter && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              rowButtons(treeRef.current)[0]?.focus();
            }
          }}
          disabled={disabled}
          placeholder="Filter decks…"
          spellCheck={false}
          className="mb-2 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm placeholder:text-foreground/40 focus:border-foreground/30 focus:outline-none"
        />
      )}

      <div
        ref={treeRef}
        onKeyDown={onTreeKeyDown}
        aria-label="Decks"
        className={`overflow-y-auto rounded-md border border-border p-1 ${
          // With a filter above, keep the box a constant height so typing a
          // query doesn't reflow the dialog under the user's eyes.
          showFilter ? "h-56" : "max-h-56"
        }`}
      >
        {decks === null ? (
          <p className="px-2 py-1.5 text-sm text-foreground/50">Loading decks…</p>
        ) : matches ? (
          matches.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-foreground/50">
              No decks match “{query.trim()}”.
            </p>
          ) : (
            matches.map((deck) => renderMatchRow(deck))
          )
        ) : (
          <>
            {allowTopLevel && renderRow("", 0)}
            {tree.map((node) => renderTree(node, allowTopLevel ? 1 : 0))}
            {draftParent === "" && renderDraftInput(allowTopLevel ? 1 : 0)}
            {allDecks.length === 0 && !allowTopLevel && draftParent === null && (
              <p className="px-2 py-1.5 text-sm text-foreground/50">No decks yet.</p>
            )}
          </>
        )}
      </div>

      {allowCreate && allowCreateTopLevel && (
        <button
          type="button"
          onClick={() => startDraft("")}
          disabled={disabled}
          className="mt-2 flex items-center gap-1 rounded-md px-1 py-0.5 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <Plus size={13} weight="bold" />
          New top-level deck
        </button>
      )}
    </div>
  );

  // Flat row shown while filtering: dim parent path + leaf, like the decks page
  // search results.
  function renderMatchRow(deck: string) {
    const reason = disable?.(deck) ?? null;
    const isSelected = value === deck;
    const parent = deckParent(deck);
    return (
      <button
        key={deck}
        type="button"
        data-picker-row
        data-deck={deck}
        data-selected={isSelected || undefined}
        onClick={() => {
          select(deck);
          setQuery("");
        }}
        disabled={disabled || reason !== null}
        tabIndex={rowTabIndex(deck)}
        title={reason ?? formatDeckPath(deck)}
        aria-pressed={isSelected}
        className={`flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          isSelected
            ? "bg-foreground/10 font-medium"
            : reason !== null
              ? "cursor-not-allowed text-foreground/30"
              : "hover:bg-foreground/5"
        }`}
      >
        <span className="truncate">
          {parent && (
            <span className="text-foreground/40">{formatDeckPath(parent)} / </span>
          )}
          {deckLeaf(deck)}
        </span>
        {!realSet.has(deck) && <>{" "}<NewBadge /></>}
        {isSelected && <Check size={14} weight="bold" className="ml-auto shrink-0" />}
      </button>
    );
  }
}

function NewBadge() {
  return (
    <span className="shrink-0 rounded bg-foreground/10 px-1 text-[10px] font-medium uppercase tracking-wide text-foreground/50">
      new
    </span>
  );
}

/** The enabled, focusable picker rows currently in the DOM, in visual order. */
function rowButtons(root: HTMLElement | null): HTMLButtonElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLButtonElement>("[data-picker-row]"),
  ).filter((b) => !b.disabled);
}
