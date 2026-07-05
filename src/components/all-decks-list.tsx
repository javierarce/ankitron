import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Minus } from "@phosphor-icons/react/dist/ssr/Minus";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical";
import { ankiFetch } from "@/lib/anki-fetch";
import {
  buildDeckTree,
  canDeleteDeck,
  compareDeckPaths,
  deckLeaf,
  deckParent,
  formatDeckPath,
  renameDeck,
  type DeckNode,
} from "@/lib/deck";
import { recordDeckRedirect } from "@/lib/deck-redirects";
import { foldText } from "@/lib/fold-text";
import {
  buildExport,
  downloadDeckJson,
  fetchCardDecksByNoteId,
} from "@/lib/import-export";
import type { DueCounts, Note } from "@/lib/types";
import { useVimNav } from "@/hooks/use-vim-nav";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { useMenuPlacement } from "@/hooks/use-menu-placement";
import { CardForm } from "./card-form";
import { DeleteDeckDialog } from "./delete-deck-dialog";
import { MoveDeckDialog } from "./move-deck-dialog";
import { DecksImportExport } from "./decks-import-export";
import { ImportResultModal } from "./import-result-modal";

// Whether a deck (or any of its subdecks, since studying a deck includes them)
// has cards due. While due counts are still loading we report `true` so the
// Study action stays enabled rather than flickering disabled then enabled.
function deckCanStudy(
  deck: string,
  dueCounts: Record<string, DueCounts>,
  dueLoaded: boolean,
): boolean {
  if (!dueLoaded) return true;
  for (const [name, due] of Object.entries(dueCounts)) {
    if (
      (name === deck || name.startsWith(deck + "::")) &&
      due.new + due.learn + due.review > 0
    ) {
      return true;
    }
  }
  return false;
}

interface AllDecksListProps {
  decks: string[];
  noteCounts: Record<string, number>;
  /** Due counts per deck; drives whether a row's Study action is enabled. */
  dueCounts: Record<string, DueCounts>;
  /** Re-fetch decks/counts after a change (e.g. a note added from the menu). */
  onRefresh: () => void;
}

export function AllDecksList({
  decks,
  noteCounts,
  dueCounts,
  onRefresh,
}: AllDecksListProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Mirror of `expanded` the keyboard callbacks can read without being rebuilt
  // (and re-subscribing useVimNav) on every toggle.
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const [showDialog, setShowDialog] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Deck to add a card to (renders the CardForm when set).
  const [addCardDeck, setAddCardDeck] = useState<string | null>(null);

  // Deck pending deletion (renders the confirm dialog when set).
  const [deletingDeck, setDeletingDeck] = useState<string | null>(null);

  // Deck being moved (renders the move dialog when set).
  const [movingDeck, setMovingDeck] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  // Export failures reuse the import result modal purely as an error display.
  const [exportError, setExportError] = useState<string | null>(null);

  const hasDialog =
    showDialog ||
    addCardDeck !== null ||
    deletingDeck !== null ||
    movingDeck !== null;

  const dueLoaded = Object.keys(dueCounts).length > 0;

  // Every deck that has at least one subdeck (each proper ancestor prefix), so
  // h/l (and ←/→) know whether a focused row is collapsible.
  const decksWithChildren = useMemo(() => {
    const s = new Set<string>();
    for (const d of decks) {
      const parts = d.split("::");
      for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join("::"));
    }
    return s;
  }, [decks]);

  const expandRow = useCallback(
    (el: HTMLElement) => {
      const name = el.dataset.deck;
      if (!name || !decksWithChildren.has(name)) return;
      setExpanded((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
    },
    [decksWithChildren],
  );

  const collapseRow = useCallback(
    (el: HTMLElement) => {
      const name = el.dataset.deck;
      if (!name) return;
      // Open parent → collapse it; otherwise hop focus up to the parent row,
      // matching how h behaves in a file tree.
      if (decksWithChildren.has(name) && expandedRef.current.has(name)) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        return;
      }
      const parent = deckParent(name);
      if (!parent) return;
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>("[data-deck]"),
      );
      const parentRow = rows.find((r) => r.dataset.deck === parent);
      parentRow?.focus();
      parentRow?.scrollIntoView({ block: "nearest" });
    },
    [decksWithChildren],
  );

  useVimNav({ enabled: !hasDialog, onExpand: expandRow, onCollapse: collapseRow });
  // CardForm (addCardDeck) locks scroll itself; lock for the inline Create Deck
  // dialog so the deck list behind it can't scroll on wheel.
  useScrollLock(showDialog);

  useEffect(() => {
    if (showDialog) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [showDialog]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (hasDialog) {
        if (e.key === "Escape") closeDialog();
        return;
      }
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (((e.metaKey || e.ctrlKey) && e.key === "f") || (e.key === "/" && !inField)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasDialog]);

  function openDialog() {
    setNewDeckName("");
    setError(null);
    setShowDialog(true);
  }

  function closeDialog() {
    setShowDialog(false);
    setNewDeckName("");
    setError(null);
  }

  function toggle(fullName: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  async function handleCreateDeck(e: React.FormEvent) {
    e.preventDefault();
    const name = newDeckName.trim();
    if (!name) return;
    // Anki's createDeck silently returns the existing deck, so guard here —
    // otherwise "creating" a duplicate just navigates to it with no feedback.
    if (decks.some((d) => d.toLowerCase() === name.toLowerCase())) {
      setError("A deck with this name already exists.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await ankiFetch("createDeck", { deck: name });
      closeDialog();
      navigate(`/decks/${encodeURIComponent(name)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deck");
    } finally {
      setCreating(false);
    }
  }

  const trimmedNewName = newDeckName.trim();
  const deckNameExists = decks.some(
    (d) => d.toLowerCase() === trimmedNewName.toLowerCase(),
  );

  // noteCounts already spans subdecks (the `deck:` search matches descendants),
  // so a deck's own entry is the full total — use it directly. It surfaces the
  // hidden total so a parent that looks "Empty" but holds notes under its
  // children can't be deleted by surprise. Counts load after the rows, so this
  // may be undefined; pass it through and let the dialog count on demand rather
  // than warning about "0 notes".
  const deletingSubdeckCount = deletingDeck
    ? decks.filter((d) => d.startsWith(deletingDeck + "::")).length
    : 0;
  const deletingNoteTotal = deletingDeck ? noteCounts[deletingDeck] : undefined;

  // Move mirrors the deck-settings flow: renameDeck moves the deck (and its
  // subtree) under the chosen parent, then we record redirects and refresh.
  async function handleMove(newName: string) {
    if (!movingDeck) return;
    setMoving(true);
    setMoveError(null);
    try {
      const renames = await renameDeck(movingDeck, newName, ankiFetch);
      setMovingDeck(null);
      setMoving(false);
      // No-op (e.g. a case-only change) — nothing moved.
      if (renames.length === 0) return;
      for (const { from, to } of renames) recordDeckRedirect(from, to);
      onRefresh();
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Move failed.");
      setMoving(false);
    }
  }

  // Export a single deck straight to a JSON download — same payload the
  // Decks-header and deck-settings exports build.
  async function handleExport(deck: string) {
    setExportError(null);
    try {
      const noteIds = await ankiFetch<number[]>("findNotes", {
        query: `deck:"${deck}"`,
      });
      const notes =
        noteIds.length === 0
          ? []
          : await ankiFetch<Note[]>("notesInfo", { notes: noteIds });
      const cardDecksByNoteId = await fetchCardDecksByNoteId(notes, ankiFetch);
      const payload = buildExport(deck, notes, undefined, cardDecksByNoteId);
      await downloadDeckJson(payload, deck);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    }
  }

  const tree = useMemo(() => buildDeckTree(decks), [decks]);
  const q = foldText(query.trim());
  // While searching, show a flat list of matches with their full path — the
  // collapsed tree would otherwise hide matching subdecks.
  const matches = q
    ? [...decks].sort(compareDeckPaths).filter((d) => foldText(d).includes(q))
    : null;

  return (
    <div className="fade-in">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Decks</h1>
        <div className="flex items-center gap-2">
          <DecksImportExport decks={decks} />
          <button
            onClick={openDialog}
            className="shrink-0 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Add deck
          </button>
        </div>
      </div>

      <div className="mb-4">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) setQuery("");
              else searchRef.current?.blur();
            }
          }}
          spellCheck={false}
          placeholder="Search decks…"
          className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:outline-none focus:border-foreground/30"
        />
      </div>

      {decks.length === 0 ? (
        <p className="text-foreground/50">
          No decks found. Create one or check that Anki is running.
        </p>
      ) : matches && matches.length === 0 ? (
        <p className="text-foreground/50">No decks match “{query.trim()}”.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="divide-y divide-border">
            {matches
              ? matches.map((deck) => (
                  <SearchRow
                    key={deck}
                    deck={deck}
                    count={noteCounts[deck]}
                    canStudy={deckCanStudy(deck, dueCounts, dueLoaded)}
                    onAddCard={() => setAddCardDeck(deck)}
                    onMove={() => setMovingDeck(deck)}
                    onExport={() => handleExport(deck)}
                    onDelete={() => setDeletingDeck(deck)}
                  />
                ))
              : tree.map((node) => (
                  <TreeRows
                    key={node.fullName}
                    node={node}
                    depth={0}
                    expanded={expanded}
                    onToggle={toggle}
                    noteCounts={noteCounts}
                    dueCounts={dueCounts}
                    dueLoaded={dueLoaded}
                    onAddCard={setAddCardDeck}
                    onMove={setMovingDeck}
                    onExport={handleExport}
                    onDelete={setDeletingDeck}
                  />
                ))}
          </div>
        </div>
      )}

      {showDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold">Create New Deck</h3>
            <form onSubmit={handleCreateDeck}>
              <input
                ref={inputRef}
                type="text"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                spellCheck={false}
                placeholder="Deck name…"
                className="w-full rounded-lg border border-border bg-transparent px-4 py-2 text-sm placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
              {deckNameExists ? (
                <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
                  A deck named “{trimmedNewName}” already exists.
                </p>
              ) : error ? (
                <p className="mt-2 text-sm text-red-500">{error}</p>
              ) : null}
              <div className="mt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={creating}
                  className="rounded-lg px-4 py-2 text-sm text-foreground/60 hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !trimmedNewName || deckNameExists}
                  className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-40"
                >
                  {creating ? "Creating…" : "Create Deck"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {addCardDeck && (
        <CardForm
          deckName={addCardDeck}
          onClose={() => setAddCardDeck(null)}
          onSaved={() => {
            setAddCardDeck(null);
            onRefresh();
          }}
        />
      )}

      {deletingDeck && (
        <DeleteDeckDialog
          deckName={deletingDeck}
          noteCount={deletingNoteTotal}
          subdeckCount={deletingSubdeckCount}
          onCancel={() => setDeletingDeck(null)}
          onDeleted={() => {
            setDeletingDeck(null);
            onRefresh();
          }}
        />
      )}

      {movingDeck && (
        <MoveDeckDialog
          deckName={movingDeck}
          moving={moving}
          error={moveError}
          onCancel={() => {
            setMovingDeck(null);
            setMoveError(null);
          }}
          onConfirm={handleMove}
        />
      )}

      {exportError && (
        <ImportResultModal
          result={null}
          error={exportError}
          errorTitle="Export failed"
          onClose={() => setExportError(null)}
        />
      )}
    </div>
  );
}

function CountLabel({ count }: { count: number | undefined }) {
  // Counts load after the deck names. Show nothing until a deck's count arrives
  // (no placeholder), then fade the number in rather than popping it.
  if (count === undefined) return null;
  return (
    <span className="count-fade-in shrink-0 text-sm tabular-nums text-foreground/50">
      {count === 0 ? "Empty" : `${count} ${count === 1 ? "note" : "notes"}`}
    </span>
  );
}

// One tree node plus (when expanded) its descendants. Fragments keep every row a
// direct child of the divider container so the row separators stay even.
function TreeRows({
  node,
  depth,
  expanded,
  onToggle,
  noteCounts,
  dueCounts,
  dueLoaded,
  onAddCard,
  onMove,
  onExport,
  onDelete,
}: {
  node: DeckNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (fullName: string) => void;
  noteCounts: Record<string, number>;
  dueCounts: Record<string, DueCounts>;
  dueLoaded: boolean;
  onAddCard: (deck: string) => void;
  onMove: (deck: string) => void;
  onExport: (deck: string) => void;
  onDelete: (deck: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.fullName);

  return (
    <Fragment>
      <div
        className="deck-nav-row flex items-center gap-2 py-3 pr-4 transition-[background-color] hover:bg-foreground/5"
        style={{ paddingLeft: 16 + depth * 24 }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.fullName)}
            aria-label={isOpen ? "Collapse" : "Expand"}
            aria-expanded={isOpen}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground/40 transition-colors hover:bg-foreground/10 hover:text-foreground/70"
          >
            {isOpen ? <Minus size={14} weight="bold" /> : <Plus size={14} weight="bold" />}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden />
        )}
        <Link
          data-nav-item
          data-deck={node.fullName}
          to={`/decks/${encodeURIComponent(node.fullName)}`}
          className="min-w-0 flex-1 truncate font-medium"
          title={formatDeckPath(node.fullName)}
        >
          {node.name}
        </Link>
        <CountLabel count={noteCounts[node.fullName]} />
        <DeckRowMenu
          deck={node.fullName}
          canStudy={deckCanStudy(node.fullName, dueCounts, dueLoaded)}
          canDelete={canDeleteDeck(node.fullName, noteCounts[node.fullName])}
          onAddCard={() => onAddCard(node.fullName)}
          onMove={() => onMove(node.fullName)}
          onExport={() => onExport(node.fullName)}
          onDelete={() => onDelete(node.fullName)}
        />
      </div>
      {hasChildren &&
        isOpen &&
        node.children.map((child) => (
          <TreeRows
            key={child.fullName}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            noteCounts={noteCounts}
            dueCounts={dueCounts}
            dueLoaded={dueLoaded}
            onAddCard={onAddCard}
            onMove={onMove}
            onExport={onExport}
            onDelete={onDelete}
          />
        ))}
    </Fragment>
  );
}

// Flat row used while searching — shows the full path so matches read clearly
// even when their parent is collapsed or filtered out.
function SearchRow({
  deck,
  count,
  canStudy,
  onAddCard,
  onMove,
  onExport,
  onDelete,
}: {
  deck: string;
  count: number | undefined;
  canStudy: boolean;
  onAddCard: () => void;
  onMove: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const parent = deckParent(deck);
  return (
    <div className="deck-nav-row flex items-center gap-3 px-4 py-3 transition-[background-color] hover:bg-foreground/5">
      <Link
        data-nav-item
        to={`/decks/${encodeURIComponent(deck)}`}
        className="min-w-0 flex-1 truncate"
        title={formatDeckPath(deck)}
      >
        {parent && (
          <span className="text-foreground/40">{formatDeckPath(parent)} / </span>
        )}
        <span className="font-medium">{deckLeaf(deck)}</span>
      </Link>
      <CountLabel count={count} />
      <DeckRowMenu
        deck={deck}
        canStudy={canStudy}
        canDelete={canDeleteDeck(deck, count)}
        onAddCard={onAddCard}
        onMove={onMove}
        onExport={onExport}
        onDelete={onDelete}
      />
    </div>
  );
}

function DeckRowMenu({
  deck,
  canStudy,
  canDelete,
  onAddCard,
  onMove,
  onExport,
  onDelete,
}: {
  deck: string;
  canStudy: boolean;
  canDelete: boolean;
  onAddCard: () => void;
  onMove: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Render in a portal (escaping the table's overflow-hidden clip) at flip-aware
  // fixed coordinates, so a menu near the bottom of the list opens upward
  // instead of being cut off.
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

  const encoded = encodeURIComponent(deck);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Deck actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="shrink-0 rounded-md p-1 text-foreground/30 transition-all hover:bg-foreground/5 hover:text-foreground/60"
      >
        <DotsThreeVertical size={22} weight="bold" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={style}
            className="z-50 flex w-max min-w-[160px] flex-col overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg"
          >
            <button
              disabled={!canStudy}
              onClick={() => {
                setOpen(false);
                navigate(`/decks/${encoded}/study`);
              }}
              title={canStudy ? undefined : "Nothing to study in this deck"}
              className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:text-foreground/30 disabled:hover:bg-transparent"
            >
              Study
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onAddCard();
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 transition-colors hover:bg-foreground/5"
            >
              Add a note
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onMove();
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 transition-colors hover:bg-foreground/5"
            >
              Move
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onExport();
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 transition-colors hover:bg-foreground/5"
            >
              Export
            </button>
            <button
              onClick={() => {
                setOpen(false);
                navigate(`/decks/${encoded}/settings`);
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 transition-colors hover:bg-foreground/5"
            >
              Settings
            </button>
            <button
              disabled={!canDelete}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              title={
                canDelete ? undefined : "The Default deck has no notes to remove"
              }
              className="w-full px-3 py-1.5 text-left text-sm text-red-500 transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:text-red-500/30 disabled:hover:bg-transparent"
            >
              Delete deck
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
