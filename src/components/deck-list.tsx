"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
      {dueDecks.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold">Due for review</h2>
          <div className="grid gap-2">
            {dueDecks.map((deck) => {
              const parts = deck.split("::");
              const leaf = parts[parts.length - 1];
              const prefix = parts.length > 1 ? parts.slice(0, -1).join("::") + "::" : null;
              return (
                <Link
                  key={deck}
                  href={`/decks/${encodeURIComponent(deck)}/study`}
                  className="flex items-center justify-between rounded-lg border border-foreground/10 px-4 py-3 transition-colors hover:bg-foreground/5"
                >
                  <span className="font-medium">
                    {prefix && <span className="text-foreground/40">{prefix}</span>}
                    {leaf}
                  </span>
                  <span className="text-sm text-foreground/50">
                    {dueCounts[deck]} due
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">All decks</h2>
          <button
            onClick={openDialog}
            className="rounded-lg border border-foreground/15 px-3 py-1.5 text-sm font-medium text-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
          >
            + New Deck
          </button>
        </div>

        {tree.length === 0 ? (
          <p className="text-foreground/50">No decks found. Create one or check that Anki is running.</p>
        ) : (
          <div className="grid gap-0.5">
            {tree.map((node) => (
              <DeckTreeItem key={node.fullName} node={node} depth={0} dueCounts={dueCounts} />
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

function DeckTreeItem({
  node,
  depth,
  dueCounts,
}: {
  node: DeckTreeNode;
  depth: number;
  dueCounts: Record<string, number>;
}) {
  const due = dueCounts[node.fullName] ?? 0;

  return (
    <>
      {node.isDeck ? (
        <Link
          href={`/decks/${encodeURIComponent(node.fullName)}`}
          className="flex items-center justify-between rounded-lg border border-foreground/10 px-4 py-3 transition-colors hover:bg-foreground/5"
          style={{ paddingLeft: `${1 + depth * 1.25}rem` }}
        >
          <span className="font-medium">{node.name}</span>
          <span className="text-foreground/40 text-sm">
            {due > 0 ? `${due} due` : "\u2192"}
          </span>
        </Link>
      ) : (
        <div
          className="flex items-center rounded-lg px-4 py-2 text-foreground/50 text-sm"
          style={{ paddingLeft: `${1 + depth * 1.25}rem` }}
        >
          {node.name}
        </div>
      )}
      {node.children.map((child) => (
        <DeckTreeItem
          key={child.fullName}
          node={child}
          depth={depth + 1}
          dueCounts={dueCounts}
        />
      ))}
    </>
  );
}
