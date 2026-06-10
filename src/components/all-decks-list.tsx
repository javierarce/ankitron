import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { ankiFetch } from "@/lib/anki-fetch";
import { useVimNav } from "@/hooks/use-vim-nav";
import type { DueCounts } from "@/lib/types";
import { DueCountsBadges } from "./deck-list";
import { DecksImportExport } from "./decks-import-export";

interface DeckTreeNode {
  name: string;
  fullName: string;
  children: DeckTreeNode[];
  isDeck: boolean;
}

function buildDeckTree(decks: string[]): DeckTreeNode[] {
  const root: DeckTreeNode[] = [];
  const deckSet = new Set(decks);
  const sorted = [...decks].sort();
  for (const deck of sorted) {
    const parts = deck.split("::");
    let siblings = root;
    for (let i = 0; i < parts.length; i++) {
      const fullName = parts.slice(0, i + 1).join("::");
      let node = siblings.find((n) => n.fullName === fullName);
      if (!node) {
        node = {
          name: parts[i],
          fullName,
          children: [],
          isDeck: deckSet.has(fullName),
        };
        siblings.push(node);
      }
      siblings = node.children;
    }
  }
  return root;
}

interface AllDecksListProps {
  decks: string[];
  dueCounts: Record<string, DueCounts>;
}

export function AllDecksList({ decks, dueCounts }: AllDecksListProps) {
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useVimNav({ enabled: !showDialog });

  useEffect(() => {
    if (showDialog) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") closeDialog();
      }
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        clearTimeout(t);
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [showDialog]);

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

  async function handleCreateDeck(e: React.FormEvent) {
    e.preventDefault();
    const name = newDeckName.trim();
    if (!name) return;
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

  const tree = buildDeckTree(decks);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">All decks</h2>
        <div className="flex items-center gap-2">
          <DecksImportExport decks={decks} />
          <button
            onClick={openDialog}
            className="flex items-center gap-1.5 rounded-lg border border-foreground/15 px-3 py-1.5 text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
          >
            <Plus size={14} weight="bold" />
            New Deck
          </button>
        </div>
      </div>

      {tree.length === 0 ? (
        <p className="text-foreground/50">
          No decks found. Create one or check that Anki is running.
        </p>
      ) : (
        <AllDecksTree tree={tree} dueCounts={dueCounts} />
      )}

      {showDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div
            className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg"
          >
            <h3 className="mb-4 text-lg font-semibold">Create New Deck</h3>
            <form onSubmit={handleCreateDeck}>
              <input
                ref={inputRef}
                type="text"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                placeholder="Deck name..."
                className="w-full rounded-lg border border-foreground/15 bg-transparent px-4 py-2 text-sm placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-foreground/20"
              />
              {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
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
                  disabled={creating || !newDeckName.trim()}
                  className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
                >
                  {creating ? "Creating..." : "Create Deck"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// A titled group card with a header bar matching the home/study page (minus
// the NEW/LEARN/DUE column labels).
function GroupShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-foreground/10 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="border-b border-foreground/5 bg-foreground/[0.02] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground/50">
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// Top level: collect single decks (no subdecks) into one "Single decks" group;
// decks with subdecks each get their own named group.
function AllDecksTree({
  tree,
  dueCounts,
}: {
  tree: DeckTreeNode[];
  dueCounts: Record<string, DueCounts>;
}) {
  const singles = tree.filter((n) => n.children.length === 0);
  const groups = tree.filter((n) => n.children.length > 0);

  return (
    <div className="grid gap-4">
      {singles.length > 0 && (
        <GroupShell title="Single decks">
          <DeckNodeGrid nodes={singles} dueCounts={dueCounts} />
        </GroupShell>
      )}
      {groups.map((node) => (
        <DeckGroup key={node.fullName} node={node} dueCounts={dueCounts} />
      ))}
    </div>
  );
}

function DeckCard({
  node,
  dueCounts,
  label,
}: {
  node: DeckTreeNode;
  dueCounts: Record<string, DueCounts>;
  label?: string;
}) {
  const due = dueCounts[node.fullName];

  return (
    <Link
      data-nav-item
      to={`/decks/${encodeURIComponent(node.fullName)}`}
      className="flex min-h-[5.5rem] flex-col justify-between gap-3 rounded-xl border border-foreground/10 bg-background p-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-colors hover:bg-foreground/5"
    >
      <span className="font-medium">{label ?? node.name}</span>
      <span className="self-end">
        <DueCountsBadges due={due} />
      </span>
    </Link>
  );
}

function DeckNodeGrid({
  nodes,
  dueCounts,
  leading,
}: {
  nodes: DeckTreeNode[];
  dueCounts: Record<string, DueCounts>;
  leading?: React.ReactNode;
}) {
  const cards = nodes.filter((n) => n.children.length === 0);
  const groups = nodes.filter((n) => n.children.length > 0);

  return (
    <div className="grid gap-3">
      {(leading || cards.length > 0) && (
        <div className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {leading}
          {cards.map((node) => (
            <DeckCard key={node.fullName} node={node} dueCounts={dueCounts} />
          ))}
        </div>
      )}
      {groups.map((node) => (
        <DeckGroup key={node.fullName} node={node} dueCounts={dueCounts} />
      ))}
    </div>
  );
}

function DeckGroup({
  node,
  dueCounts,
}: {
  node: DeckTreeNode;
  dueCounts: Record<string, DueCounts>;
}) {
  return (
    <GroupShell title={node.name}>
      <DeckNodeGrid
        nodes={node.children}
        dueCounts={dueCounts}
        leading={
          node.isDeck ? (
            <DeckCard node={node} dueCounts={dueCounts} label="All decks" />
          ) : undefined
        }
      />
    </GroupShell>
  );
}
