import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FolderSimple } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { Tag } from "@phosphor-icons/react/dist/ssr/Tag";
import { Cards } from "@phosphor-icons/react/dist/ssr/Cards";
import { CircleHalf } from "@phosphor-icons/react/dist/ssr/CircleHalf";
import { CalendarPlus } from "@phosphor-icons/react/dist/ssr/CalendarPlus";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Star } from "@phosphor-icons/react/dist/ssr/Star";
import { Sliders } from "@phosphor-icons/react/dist/ssr/Sliders";
import { Sparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { Clock } from "@phosphor-icons/react/dist/ssr/Clock";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/ssr/ArrowsClockwise";
import { GraduationCap } from "@phosphor-icons/react/dist/ssr/GraduationCap";
import { Pause } from "@phosphor-icons/react/dist/ssr/Pause";
import { Eye } from "@phosphor-icons/react/dist/ssr/Eye";
import { Flag } from "@phosphor-icons/react/dist/ssr/Flag";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import {
  activeTokenAt,
  applySuggestion,
  contextQuery,
  highlightQuery,
  suggestionsFor,
  type HighlightKind,
  type Suggestion,
  type SuggestionSources,
} from "@/lib/search-query";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Decks, tags, and note types to autocomplete against. Scoped by the caller
   * to what's actually present where you're searching, so a deck only offers
   * its own tags and subdecks — not everything in the collection.
   */
  sources: SuggestionSources;
  /**
   * Reports the query around the token being edited (everything but that token),
   * so the caller can narrow `sources` to the notes matching the rest of the
   * query — e.g. only tags that co-occur with an already-applied filter.
   */
  onContextChange?: (context: string) => void;
  placeholder?: string;
  /** Extra classes for the outer wrapper, e.g. width/flex. */
  className?: string;
}

// Icon per autocomplete row, keyed by Suggestion.iconKey (a qualifier name, or
// an is: state for those rows). Falls back to the search glass.
const ICONS: Record<string, typeof MagnifyingGlass> = {
  deck: FolderSimple,
  tag: Tag,
  is: CircleHalf,
  flag: Flag,
  note: Cards,
  added: CalendarPlus,
  edited: PencilSimple,
  rated: Star,
  prop: Sliders,
  // is: states, so each gets its own glyph
  new: Sparkle,
  due: Clock,
  review: ArrowsClockwise,
  learn: GraduationCap,
  suspended: Pause,
  buried: Eye,
};

// Colour per highlight run. The qualifier keyword is muted; its value gets a
// soft blue chip, echoing GitHub tinting `label:bug`.
const SEGMENT_CLASS: Record<HighlightKind, string> = {
  plain: "",
  qualifier: "text-foreground/55",
  value: "rounded bg-blue-500/15 text-blue-700 dark:text-blue-300",
};

// Layout-affecting styles shared verbatim by the coloured backdrop and the
// editable input — font, size, padding, border width, and single-line wrapping
// must match exactly so the caret lines up with the text rendered behind it.
const FIELD = "w-full rounded-lg border px-3 py-2 text-sm";

/**
 * GitHub-issue-style search box over Anki's search syntax. A transparent input
 * sits above a coloured backdrop (recognised `deck:French` / `is:due` tokens get
 * tinted), with a dropdown that completes qualifiers and their values as you
 * type. Parsing and colouring live in lib/search-query; this owns the caret,
 * keyboard nav, and menu.
 *
 * Forwards its ref to the underlying <input> so callers keep focus/select/blur
 * (the Cmd-F and "/" shortcuts rely on it).
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    { value, onChange, sources, onContextChange, placeholder, className },
    ref,
  ) {
    const innerRef = useRef<HTMLInputElement>(null);
    const backdropRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => innerRef.current!, []);

    const [open, setOpen] = useState(false);
    const [cursor, setCursor] = useState(0);
    const [highlight, setHighlight] = useState(0);
    // Set when the user presses Down on a closed menu: lets the full command
    // list show even for an empty token, without the menu popping on mere focus.
    const [revealAll, setRevealAll] = useState(false);

    // After we rewrite `value` to apply a suggestion, restore the caret once the
    // controlled input has re-rendered with the new text.
    const pendingCursor = useRef<number | null>(null);
    useLayoutEffect(() => {
      if (pendingCursor.current !== null && innerRef.current) {
        const pos = pendingCursor.current;
        innerRef.current.setSelectionRange(pos, pos);
        setCursor(pos);
        pendingCursor.current = null;
      }
    }, [value]);

    const token = activeTokenAt(value, cursor);
    const suggestions = suggestionsFor(token, sources, value);

    // Report the surrounding query (sans the token being edited) so the caller
    // can narrow `sources`. Keep the callback in a ref so a fresh inline
    // callback each render doesn't refire the effect — only a changed context
    // string should.
    const context = contextQuery(value, cursor);
    const onContextChangeRef = useRef(onContextChange);
    onContextChangeRef.current = onContextChange;
    useEffect(() => {
      onContextChangeRef.current?.(context);
    }, [context]);
    // Surface the menu once the user types something matching a qualifier or
    // value — never just from focusing the box (an empty token would otherwise
    // dump the whole list on tap). Pressing Down (revealAll) opts into showing
    // the full command list for an empty token on demand.
    const showMenu =
      open && suggestions.length > 0 && (token.text !== "" || revealAll);

    function accept(s: Suggestion) {
      const next = applySuggestion(value, token, s);
      pendingCursor.current = next.cursor;
      onChange(next.query);
      setHighlight(0);
      // Keep the menu open after a keyword (`deck:`) so values appear next.
      setOpen(s.continues);
    }

    function syncCursor() {
      setCursor(innerRef.current?.selectionStart ?? value.length);
    }

    function handleKeyDown(e: React.KeyboardEvent) {
      if (e.key === "ArrowDown") {
        if (showMenu) {
          e.preventDefault();
          setHighlight((h) => (h + 1) % suggestions.length);
          return;
        }
        // Closed menu: open it and show whatever's available for this token —
        // the full command list when nothing's been typed yet.
        if (suggestions.length > 0) {
          e.preventDefault();
          setOpen(true);
          setRevealAll(true);
          setHighlight(0);
          return;
        }
      }
      if (showMenu && e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (showMenu && (e.key === "Enter" || e.key === "Tab")) {
        e.preventDefault();
        accept(suggestions[highlight]);
        return;
      }
      if (e.key === "Escape") {
        if (showMenu) {
          // Scope to the menu so Escape doesn't also bubble up and clear focus.
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setRevealAll(false);
          return;
        }
        if (value) onChange("");
        else innerRef.current?.blur();
      }
    }

    return (
      <div className={`relative ${className ?? ""}`}>
        <div className="relative">
          <div
            ref={backdropRef}
            aria-hidden
            className={`${FIELD} pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre border-transparent text-foreground`}
          >
            {highlightQuery(value).map((seg, i) => (
              <span key={i} className={SEGMENT_CLASS[seg.kind]}>
                {seg.text}
              </span>
            ))}
          </div>
          <input
            ref={innerRef}
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setCursor(e.target.selectionStart ?? e.target.value.length);
              setOpen(true);
              setHighlight(0);
              // Typing reverts to the type-to-match rule: a non-empty token
              // shows the menu on its own, and clearing the box back to empty
              // shouldn't re-dump the full list that ArrowDown opted into.
              setRevealAll(false);
            }}
            onKeyDown={handleKeyDown}
            onSelect={syncCursor}
            // Keep the coloured backdrop aligned when the text scrolls past the
            // edge of the box.
            onScroll={(e) => {
              if (backdropRef.current) {
                backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
            // Commit on blur with a tick of delay so a menu click lands first.
            onBlur={() =>
              setTimeout(() => {
                setOpen(false);
                setRevealAll(false);
              }, 100)
            }
            // Cards dragged onto a segment carry note ids as text/plain; block
            // dropping that into the search box.
            onDrop={(e) => e.preventDefault()}
            spellCheck={false}
            placeholder={placeholder}
            className={`${FIELD} relative border-border bg-transparent text-transparent caret-foreground placeholder:text-foreground/40 focus:border-foreground/30 focus:outline-none`}
          />
        </div>
        {showMenu && (
          <ul className="absolute left-0 z-30 mt-1 max-h-64 w-80 overflow-auto rounded-lg border border-border bg-background py-1 shadow-lg">
            {suggestions.map((s, i) => {
              const Icon = ICONS[s.iconKey] ?? MagnifyingGlass;
              return (
                <li key={s.apply}>
                  <button
                    type="button"
                    // mousedown (not click) so it fires before the input's blur,
                    // and preventDefault keeps focus in the field.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      accept(s);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm ${
                      i === highlight ? "bg-foreground/10" : "hover:bg-foreground/5"
                    }`}
                  >
                    <Icon
                      size={16}
                      weight={s.color ? "fill" : "regular"}
                      className={`shrink-0 ${s.color ? "" : "text-foreground/50"}`}
                      style={s.color ? { color: s.color } : undefined}
                    />
                    <span className="truncate">{s.display}</span>
                    {s.detail && (
                      <span className="ml-auto shrink-0 pl-2 text-xs text-foreground/40">
                        {s.detail}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  },
);
