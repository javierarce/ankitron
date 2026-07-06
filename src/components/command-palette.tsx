import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowElbowDownLeft } from "@phosphor-icons/react/dist/ssr/ArrowElbowDownLeft";
import { ArrowUp } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { ArrowDown } from "@phosphor-icons/react/dist/ssr/ArrowDown";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { Plus } from "@phosphor-icons/react/dist/ssr/Plus";
import { Gear } from "@phosphor-icons/react/dist/ssr/Gear";
import { Sun } from "@phosphor-icons/react/dist/ssr/Sun";
import { Moon } from "@phosphor-icons/react/dist/ssr/Moon";
import { Desktop } from "@phosphor-icons/react/dist/ssr/Desktop";
import type { Icon } from "@phosphor-icons/react";
import { fetchDeckNames } from "@/lib/decks";
import { formatDeckPath } from "@/lib/deck";
import { foldText } from "@/lib/fold-text";
import { useScrollLock, isScrollLocked } from "@/hooks/use-scroll-lock";
import { useTheme } from "@/lib/theme-context";
import { CardForm } from "./card-form";

type Mode = "search" | "pickDeckForCard";

type ActionId = "new-card" | "settings" | "theme-toggle" | "theme-system";

type ActionDef = {
  id: ActionId;
  label: string;
  keywords: string;
  icon: Icon;
  // Right-aligned hint shown on the selected row.
  hint: string;
};

type Item =
  | { kind: "action"; id: ActionId; label: string; icon: Icon; hint: string }
  | { kind: "deck"; label: string; deck: string };

export function CommandPalette() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("search");
  // True only when the deck picker was reached from the search step (via the
  // "New note…" action), so Esc has a previous step to return to. When the
  // picker is opened directly (cmd+N) there's no step to go back to.
  const [deckPickFromSearch, setDeckPickFromSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [decks, setDecks] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [addingToDeck, setAddingToDeck] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // CardForm renders its own backdrop and locks scroll itself; the palette only
  // needs the lock while its own overlay is up.
  useScrollLock(open);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setMode("search");
    setDeckPickFromSearch(false);
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
        setDeckPickFromSearch(false);
        setQuery("");
        setSelected(0);
        setOpen(true);
      } else if (mod && e.key === ",") {
        // Open settings, like a native app. Skip while a dialog is up so we
        // don't yank the user out of an open card editor and lose their edits.
        if (isScrollLocked()) return;
        e.preventDefault();
        navigate("/settings");
      } else if (mod && (e.key === "1" || e.key === "2")) {
        // Quick-nav to Study (1) / Decks (2). Skip while editing a card (any
        // dialog holds the scroll lock) or mid-study, where these would
        // interrupt what the user is doing.
        // pathname + hash so this holds under both history and hash routing
        // (the demo build uses HashRouter, where the route lives in the hash).
        const route = window.location.pathname + window.location.hash;
        if (isScrollLocked() || route.endsWith("/study")) {
          return;
        }
        e.preventDefault();
        navigate(e.key === "1" ? "/" : "/decks");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [navigate]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const names = await fetchDeckNames();
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

  const q = foldText(query.trim());
  const filteredDecks = q
    ? decks.filter((d) => foldText(d).includes(q))
    : decks;

  // Resolve the appearance actually on screen (the provider keeps this `dark`
  // class in sync) so the toggle flips to the opposite even when the theme is
  // "system".
  const isDark = document.documentElement.classList.contains("dark");

  const actions: ActionDef[] = [
    {
      id: "new-card",
      label: "New note…",
      keywords: "new note add note new card add card",
      icon: Plus,
      hint: "new note",
    },
    {
      id: "settings",
      label: "Settings",
      keywords: "settings preferences update version",
      icon: Gear,
      hint: "open",
    },
    {
      id: "theme-toggle",
      label: isDark ? "Switch to light theme" : "Switch to dark theme",
      keywords: "theme appearance dark light mode color toggle switch",
      icon: isDark ? Sun : Moon,
      hint: "switch",
    },
    {
      id: "theme-system",
      label: "System theme",
      keywords: "theme appearance system auto mode color",
      icon: Desktop,
      hint: theme === "system" ? "current" : "switch",
    },
  ];

  const filteredActions =
    mode === "search"
      ? actions.filter(
          (a) =>
            q === "" || a.label.toLowerCase().includes(q) || a.keywords.includes(q)
        )
      : [];

  const items: Item[] = [
    ...filteredActions.map((a) => ({
      kind: "action" as const,
      id: a.id,
      label: a.label,
      icon: a.icon,
      hint: a.hint,
    })),
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
      if (item.id === "settings") {
        navigate("/settings");
        close();
        return;
      }
      if (item.id === "theme-toggle") {
        setTheme(isDark ? "light" : "dark");
        close();
        return;
      }
      if (item.id === "theme-system") {
        setTheme("system");
        close();
        return;
      }
      setMode("pickDeckForCard");
      setDeckPickFromSearch(true);
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
      navigate(`/decks/${encodeURIComponent(item.deck)}`);
      close();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(selected);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (mode === "pickDeckForCard" && deckPickFromSearch) {
        setMode("search");
        setDeckPickFromSearch(false);
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
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className="mx-4 w-full max-w-xl overflow-hidden rounded-xl border border-border bg-background shadow-[0_20px_50px_rgba(0,0,0,0.25)]"
          >
            <div className="flex items-center gap-2 border-b border-border px-4">
              <MagnifyingGlass
                size={16}
                weight="regular"
                className="shrink-0 text-foreground/40"
              />
              <input
                ref={inputRef}
                type="text"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={
                  mode === "search" ? "Search decks or actions\u2026" : "Pick a deck for the new note\u2026"
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
                  const ActionIcon = item.kind === "action" ? item.icon : null;
                  return (
                    <button
                      key={item.kind === "action" ? `action:${item.id}` : `deck:${item.deck}`}
                      type="button"
                      // Keep focus on the input so arrow keys always drive the
                      // `selected` highlight. Tabbing onto a row would strand
                      // focus here, where nothing handles the arrows.
                      tabIndex={-1}
                      data-index={i}
                      onClick={() => activate(i)}
                      onMouseMove={() => setSelected(i)}
                      className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm transition-colors ${
                        isSelected ? "bg-foreground/5" : ""
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {ActionIcon && (
                          <ActionIcon size={14} weight="bold" className="text-foreground/60" />
                        )}
                        {item.kind === "action" ? (
                          <span className="font-medium">{item.label}</span>
                        ) : (
                          <DeckRow name={item.deck} query={q} />
                        )}
                      </span>
                      {isSelected && (
                        <span className="text-xs text-foreground/40">
                          {item.kind === "action"
                            ? item.hint
                            : mode === "pickDeckForCard"
                              ? "add here"
                              : "go"}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-foreground/40">
              <span>
                {mode === "pickDeckForCard" && deckPickFromSearch
                  ? "Esc to go back"
                  : "Esc to close"}
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
  // Show the parent path with " / " instead of Anki's "::" separator.
  const prefix =
    parts.length > 1 ? parts.slice(0, -1).join(" / ") + " / " : null;

  if (!query) {
    return (
      <span>
        {prefix && <span className="text-foreground/40">{prefix}</span>}
        {leaf}
      </span>
    );
  }

  return <span>{highlight(formatDeckPath(name), query)}</span>;
}

function highlight(text: string, query: string) {
  const folded = foldText(text);
  const idx = folded.indexOf(query);
  // Precomposed accents (the common case) keep a 1:1 mapping, so offsets into
  // `folded` are valid in `text`. Already-decomposed input — a letter typed as
  // base + a separate combining mark — shrinks when the mark is stripped; when
  // that shifts offsets, skip the highlight rather than slice at the wrong
  // boundary.
  if (idx === -1 || folded.length !== text.length) return text;
  return (
    <>
      <span className="text-foreground/40">{text.slice(0, idx)}</span>
      <span className="font-medium">{text.slice(idx, idx + query.length)}</span>
      <span className="text-foreground/40">{text.slice(idx + query.length)}</span>
    </>
  );
}
