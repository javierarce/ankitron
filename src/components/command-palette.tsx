"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowElbowDownLeft,
  ArrowUp,
  ArrowDown,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";
import { ankiFetch } from "@/lib/anki-fetch";
import { CardForm } from "./card-form";

type Mode = "search" | "pickDeckForCard";

type Item =
  | { kind: "action"; label: string }
  | { kind: "deck"; label: string; deck: string };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("search");
  const [query, setQuery] = useState("");
  const [decks, setDecks] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [addingToDeck, setAddingToDeck] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setMode("search");
    setSelected(0);
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const mod = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setMode("pickDeckForCard");
        setQuery("");
        setSelected(0);
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const names = await ankiFetch<string[]>("deckNames");
        if (!cancelled) setDecks([...names].sort((a, b) => a.localeCompare(b)));
      } catch {
        if (!cancelled) setDecks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open, mode]);

  const q = query.trim().toLowerCase();
  const filteredDecks = q
    ? decks.filter((d) => d.toLowerCase().includes(q))
    : decks;

  const showAction =
    mode === "search" && (q === "" || "new card".includes(q) || "add card".includes(q));

  const items: Item[] = [
    ...(showAction ? [{ kind: "action" as const, label: "New card\u2026" }] : []),
    ...filteredDecks.map((d) => ({ kind: "deck" as const, label: d, deck: d })),
  ];

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function activate(index: number) {
    const item = items[index];
    if (!item) return;
    if (item.kind === "action") {
      setMode("pickDeckForCard");
      setQuery("");
      return;
    }
    if (mode === "pickDeckForCard") {
      setAddingToDeck(item.deck);
      setOpen(false);
      setQuery("");
      setMode("search");
      setSelected(0);
    } else {
      router.push(`/decks/${encodeURIComponent(item.deck)}`);
      close();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(selected);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (mode === "pickDeckForCard") {
        setMode("search");
        setQuery("");
      } else {
        close();
      }
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh] backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="mx-4 w-full max-w-xl overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-[0_20px_50px_rgba(0,0,0,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-foreground/10 px-4">
              <MagnifyingGlass
                size={16}
                weight="regular"
                className="shrink-0 text-foreground/40"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={
                  mode === "search" ? "Search decks or actions\u2026" : "Pick a deck for the new card\u2026"
                }
                className="w-full bg-transparent py-3 text-sm placeholder:text-foreground/40 focus:outline-none"
              />
            </div>
            <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
              {items.length === 0 ? (
                <div className="px-4 py-3 text-sm text-foreground/50">No results</div>
              ) : (
                items.map((item, i) => {
                  const isSelected = i === selected;
                  return (
                    <button
                      key={item.kind === "action" ? `action:${item.label}` : `deck:${item.deck}`}
                      type="button"
                      data-index={i}
                      onClick={() => activate(i)}
                      onMouseMove={() => setSelected(i)}
                      className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors ${
                        isSelected ? "bg-foreground/5" : ""
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {item.kind === "action" && (
                          <Plus size={14} weight="bold" className="text-foreground/60" />
                        )}
                        {item.kind === "action" ? (
                          <span className="font-medium">{item.label}</span>
                        ) : (
                          <DeckRow name={item.deck} query={q} />
                        )}
                      </span>
                      {isSelected && (
                        <span className="text-xs text-foreground/40">
                          {item.kind === "action" ? "new card" : mode === "pickDeckForCard" ? "add here" : "go"}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-between border-t border-foreground/10 px-4 py-2 text-xs text-foreground/40">
              <span>
                {mode === "pickDeckForCard" ? "Esc to go back" : "Esc to close"}
              </span>
              <span className="flex items-center gap-1.5">
                <ArrowUp size={12} weight="bold" />
                <ArrowDown size={12} weight="bold" />
                <span>navigate</span>
                <span className="text-foreground/20">&middot;</span>
                <ArrowElbowDownLeft size={12} weight="bold" />
                <span>select</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {addingToDeck && (
        <CardForm
          deckName={addingToDeck}
          onClose={() => setAddingToDeck(null)}
        />
      )}
    </>
  );
}

function DeckRow({ name, query }: { name: string; query: string }) {
  const parts = name.split("::");
  const leaf = parts[parts.length - 1];
  const prefix = parts.length > 1 ? parts.slice(0, -1).join("::") + "::" : null;

  if (!query) {
    return (
      <span>
        {prefix && <span className="text-foreground/40">{prefix}</span>}
        {leaf}
      </span>
    );
  }

  return <span>{highlight(name, query)}</span>;
}

function highlight(text: string, query: string) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query);
  if (idx === -1) return text;
  return (
    <>
      <span className="text-foreground/40">{text.slice(0, idx)}</span>
      <span className="font-medium">{text.slice(idx, idx + query.length)}</span>
      <span className="text-foreground/40">{text.slice(idx + query.length)}</span>
    </>
  );
}
