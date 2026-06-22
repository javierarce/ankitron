import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Minus } from "@phosphor-icons/react/dist/ssr/Minus";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr/DotsThreeVertical";
import { ankiFetch } from "@/lib/anki-fetch";
import { compareDeckPaths, deckLeaf, deckParent, formatDeckPath } from "@/lib/deck";
import { useVimNav } from "@/hooks/use-vim-nav";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { CardForm } from "./card-form";
import { DeleteDeckDialog } from "./delete-deck-dialog";
import { DecksImportExport } from "./decks-import-export";

interface DeckNode {
  name: string;
  fullName: string;
  children: DeckNode[];
}

// Build a tree from "::"-separated deck paths. Sorted by compareDeckPaths so
// parents precede children and siblings are alphabetical; missing ancestors are
// created implicitly (Anki normally lists them, but stay robust if not).
function buildDeckTree(decks: string[]): DeckNode[] {
  const roots: DeckNode[] = [];
  const byFull = new Map<string, DeckNode>();
  for (const deck of [...decks].sort(compareDeckPaths)) {
    const parts = deck.split("::");
    let parentFull = "";
    for (let i = 0; i < parts.length; i++) {
      const fullName = parts.slice(0, i + 1).join("::");
      if (!byFull.has(fullName)) {
        const node: DeckNode = { name: parts[i], fullName, children: [] };
        byFull.set(fullName, node);
        if (i === 0) roots.push(node);
        else byFull.get(parentFull)!.children.push(node);
      }
      parentFull = fullName;
    }
  }
  return roots;
}

interface AllDecksListProps {
  decks: string[];
  noteCounts: Record<string, number>;
  /** Re-fetch decks/counts after a change (e.g. a note added from the menu). */
  onRefresh: () => void;
}

export function AllDecksList({ decks, noteCounts, onRefresh }: AllDecksListProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const [showDialog, setShowDialog] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Deck to add a card to (renders the CardForm when set).
  const [addCardDeck, setAddCardDeck] = useState<string | null>(null);

  // Deck pending deletion (renders the confirm dialog when set).
  const [deletingDeck, setDeletingDeck] = useState<string | null>(null);

  const hasDialog =
    showDialog || addCardDeck !== null || deletingDeck !== null;
  useVimNav({ enabled: !hasDialog });
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

  const tree = useMemo(() => buildDeckTree(decks), [decks]);
  const q = query.trim().toLowerCase();
  // While searching, show a flat list of matches with their full path — the
  // collapsed tree would otherwise hide matching subdecks.
  const matches = q
    ? [...decks].sort(compareDeckPaths).filter((d) => d.toLowerCase().includes(q))
    : null;

  return (
    <div>
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
          placeholder="Search decks…"
          className="w-full rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm placeholder:text-foreground/40 focus:outline-none focus:border-foreground/30"
        />
      </div>

      {decks.length === 0 ? (
        <p className="text-foreground/50">
          No decks found. Create one or check that Anki is running.
        </p>
      ) : matches && matches.length === 0 ? (
        <p className="text-foreground/50">No decks match “{query.trim()}”.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-foreground/10 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="divide-y divide-foreground/10">
            {matches
              ? matches.map((deck) => (
                  <SearchRow
                    key={deck}
                    deck={deck}
                    count={noteCounts[deck]}
                    onAddCard={() => setAddCardDeck(deck)}
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
                    onAddCard={setAddCardDeck}
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
          <div className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold">Create New Deck</h3>
            <form onSubmit={handleCreateDeck}>
              <input
                ref={inputRef}
                type="text"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                placeholder="Deck name…"
                className="w-full rounded-lg border border-foreground/15 bg-transparent px-4 py-2 text-sm placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-foreground/20"
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
                  className="rounded-lg border border-foreground/15 px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-40"
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
  onAddCard,
  onDelete,
}: {
  node: DeckNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (fullName: string) => void;
  noteCounts: Record<string, number>;
  onAddCard: (deck: string) => void;
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
          to={`/decks/${encodeURIComponent(node.fullName)}`}
          className="min-w-0 flex-1 truncate font-medium"
          title={formatDeckPath(node.fullName)}
        >
          {node.name}
        </Link>
        <CountLabel count={noteCounts[node.fullName]} />
        <DeckRowMenu
          deck={node.fullName}
          onAddCard={() => onAddCard(node.fullName)}
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
            onAddCard={onAddCard}
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
  onAddCard,
  onDelete,
}: {
  deck: string;
  count: number | undefined;
  onAddCard: () => void;
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
      <DeckRowMenu deck={deck} onAddCard={onAddCard} onDelete={onDelete} />
    </div>
  );
}

function DeckRowMenu({
  deck,
  onAddCard,
  onDelete,
}: {
  deck: string;
  onAddCard: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Fixed-position coordinates so the menu can render in a portal, escaping the
  // table's overflow-hidden clip (which otherwise cuts it off).
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
    // Close on scroll/resize rather than chase the button's moving position.
    function close() {
      setOpen(false);
    }
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setOpen(true);
  }

  const encoded = encodeURIComponent(deck);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-label="Deck actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="shrink-0 rounded-md p-1 text-foreground/30 transition-all hover:bg-foreground/5 hover:text-foreground/60"
      >
        <DotsThreeVertical size={22} weight="bold" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, right: pos.right }}
            className="z-50 min-w-[150px] rounded-lg border border-foreground/10 bg-background py-1 shadow-lg"
          >
            <button
              onClick={() => {
                setOpen(false);
                navigate(`/decks/${encoded}/study`);
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 transition-colors hover:bg-foreground/5"
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
                navigate(`/decks/${encoded}/settings`);
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-foreground/70 transition-colors hover:bg-foreground/5"
            >
              Settings
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="w-full px-3 py-1.5 text-left text-sm text-red-500 transition-colors hover:bg-foreground/5"
            >
              Delete deck
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
