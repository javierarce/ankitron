"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CaretRight, Plus } from "@phosphor-icons/react";
import { ankiFetch } from "@/lib/anki-fetch";

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

interface DeckListProps {
  decks: string[];
  dueCounts: Record<string, number>;
}

export function DeckList({ decks, dueCounts }: DeckListProps) {
  const router = useRouter();
  const [showDialog, setShowDialog] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dueDecks = decks.filter((d) => {
    if ((dueCounts[d] ?? 0) === 0) return false;
    const hasChildWithDue = decks.some(
      (other) => other !== d && other.startsWith(d + "::") && (dueCounts[other] ?? 0) > 0
    );
    return !hasChildWithDue;
  });
  const tree = buildDeckTree(decks);

  const dueGroups: { root: string; decks: string[] }[] = [];
  {
    const byRoot = new Map<string, string[]>();
    for (const d of dueDecks) {
      const root = d.split("::")[0];
      let group = byRoot.get(root);
      if (!group) {
        group = [];
        byRoot.set(root, group);
        dueGroups.push({ root, decks: group });
      }
      group.push(d);
    }
  }

  useEffect(() => {
    if (showDialog) {
      setTimeout(() => inputRef.current?.focus(), 0);
      function handleKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") closeDialog();
      }
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
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
      router.push(`/decks/${encodeURIComponent(name)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deck");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      {dueGroups.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">Due for review</h2>
          <div className="grid gap-2">
            {dueGroups.map((group) => (
              <DueGroupCard
                key={group.root}
                root={group.root}
                decks={group.decks}
                dueCounts={dueCounts}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">All decks</h2>
          <button
            onClick={openDialog}
            className="flex items-center gap-1.5 rounded-lg border border-foreground/15 px-3 py-1.5 text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
          >
            <Plus size={14} weight="bold" />
            New Deck
          </button>
        </div>

        {tree.length === 0 ? (
          <p className="text-foreground/50">No decks found. Create one or check that Anki is running.</p>
        ) : (
          <div className="grid gap-2">
            {tree.map((node) => (
              <RootDeckCard key={node.fullName} node={node} dueCounts={dueCounts} />
            ))}
          </div>
        )}
      </section>

      {/* Create deck dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeDialog}>
          <div className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
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
              {error && (
                <p className="mt-2 text-sm text-red-500">{error}</p>
              )}
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

function DueGroupCard({
  root,
  decks,
  dueCounts,
}: {
  root: string;
  decks: string[];
  dueCounts: Record<string, number>;
}) {
  if (decks.length === 1 && decks[0] === root) {
    return (
      <Link
        href={`/decks/${encodeURIComponent(root)}/study`}
        className="flex items-center justify-between rounded-xl border border-foreground/10 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-colors hover:bg-foreground/5"
      >
        <span className="font-medium">{root}</span>
        <DueBadge count={dueCounts[root]} />
      </Link>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-foreground/10 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <div className="border-b border-foreground/5 bg-foreground/[0.02] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground/50">
        {root}
      </div>
      <div className="py-1">
        {decks.map((deck) => {
          const parts = deck.split("::");
          const leaf = parts[parts.length - 1];
          const subPrefix =
            parts.length > 2 ? parts.slice(1, -1).join("::") + "::" : null;
          return (
            <Link
              key={deck}
              href={`/decks/${encodeURIComponent(deck)}/study`}
              className="flex items-center justify-between px-4 py-2 text-sm transition-colors hover:bg-foreground/5"
            >
              <span>
                {subPrefix && <span className="text-foreground/40">{subPrefix}</span>}
                {leaf}
              </span>
              <DueBadge count={dueCounts[deck]} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function DueBadge({ count }: { count: number }) {
  if (count <= 0)
    return <CaretRight size={14} weight="bold" className="text-foreground/30" />;
  return (
    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium tabular-nums text-foreground/70">
      {count}
    </span>
  );
}

function RootDeckCard({
  node,
  dueCounts,
}: {
  node: DeckTreeNode;
  dueCounts: Record<string, number>;
}) {
  const due = dueCounts[node.fullName] ?? 0;
  const hasChildren = node.children.length > 0;

  if (!hasChildren) {
    return (
      <Link
        href={`/decks/${encodeURIComponent(node.fullName)}`}
        className="flex items-center justify-between rounded-xl border border-foreground/10 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-colors hover:bg-foreground/5"
      >
        <span className="font-medium">{node.name}</span>
        <DueBadge count={due} />
      </Link>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-foreground/10 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      {node.isDeck ? (
        <Link
          href={`/decks/${encodeURIComponent(node.fullName)}`}
          className="flex items-center justify-between border-b border-foreground/5 px-4 py-3 transition-colors hover:bg-foreground/5"
        >
          <span className="font-semibold">{node.name}</span>
          <DueBadge count={due} />
        </Link>
      ) : (
        <div className="border-b border-foreground/5 bg-foreground/[0.02] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground/50">
          {node.name}
        </div>
      )}
      <div className="py-1">
        {node.children.map((child) => (
          <NestedDeckRow
            key={child.fullName}
            node={child}
            depth={0}
            dueCounts={dueCounts}
          />
        ))}
      </div>
    </div>
  );
}

function NestedDeckRow({
  node,
  depth,
  dueCounts,
}: {
  node: DeckTreeNode;
  depth: number;
  dueCounts: Record<string, number>;
}) {
  const due = dueCounts[node.fullName] ?? 0;
  const paddingLeft = `${1 + depth * 1.25}rem`;

  return (
    <>
      {node.isDeck ? (
        <Link
          href={`/decks/${encodeURIComponent(node.fullName)}`}
          className="flex items-center justify-between px-4 py-2 text-sm transition-colors hover:bg-foreground/5"
          style={{ paddingLeft }}
        >
          <span>{node.name}</span>
          <DueBadge count={due} />
        </Link>
      ) : (
        <div
          className="px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-foreground/40"
          style={{ paddingLeft }}
        >
          {node.name}
        </div>
      )}
      {node.children.map((child) => (
        <NestedDeckRow
          key={child.fullName}
          node={child}
          depth={depth + 1}
          dueCounts={dueCounts}
        />
      ))}
    </>
  );
}
