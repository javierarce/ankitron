import { Link } from "react-router-dom";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { useVimNav } from "@/hooks/use-vim-nav";
import type { DueCounts } from "@/lib/types";

interface DeckListProps {
  decks: string[];
  dueCounts: Record<string, DueCounts>;
}

function totalOf(due: DueCounts | undefined) {
  if (!due) return 0;
  return due.new + due.learn + due.review;
}

export function DeckList({ decks, dueCounts }: DeckListProps) {
  useVimNav();

  const dueDecks = decks.filter((d) => {
    if (totalOf(dueCounts[d]) === 0) return false;
    const hasChildWithDue = decks.some(
      (other) =>
        other !== d &&
        other.startsWith(d + "::") &&
        totalOf(dueCounts[other]) > 0
    );
    return !hasChildWithDue;
  });

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

  if (dueGroups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center pb-[6rem] text-foreground/50">
        {decks.length === 0
          ? "No decks found. Open Decks to create one."
          : "Nothing due. You're all caught up."}
      </div>
    );
  }

  // Top-level decks with no due subdecks get collected into one "Single decks"
  // group; decks that have due subdecks keep their own named group.
  const isSingle = (g: { root: string; decks: string[] }) =>
    g.decks.length === 1 && g.decks[0] === g.root;
  const singleDecks = dueGroups.filter(isSingle).map((g) => g.root);
  const subdeckGroups = dueGroups.filter((g) => !isSingle(g));

  return (
    <div className="flex flex-1 items-center justify-center pb-[6rem]">
      <div className="grid w-full gap-4">
        {singleDecks.length > 0 && (
          <SingleDecksCard decks={singleDecks} dueCounts={dueCounts} />
        )}
        {subdeckGroups.map((group) => (
          <DueGroupCard
            key={group.root}
            root={group.root}
            decks={group.decks}
            dueCounts={dueCounts}
          />
        ))}
      </div>
    </div>
  );
}

// Group header with the deck name and NEW / LEARN / DUE column labels aligned
// over the badge columns below (same 3-column 2rem grid as DueCountsBadges).
function GroupHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-t-xl border-b border-border bg-foreground/[0.02] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-foreground/50">
      <span>{title}</span>
      <span className="grid w-[6.5rem] grid-cols-3 text-center text-[10px] tracking-normal text-foreground/40">
        <span>New</span>
        <span>Learn</span>
        <span>Due</span>
      </span>
    </div>
  );
}

function SingleDecksCard({
  decks,
  dueCounts,
}: {
  decks: string[];
  dueCounts: Record<string, DueCounts>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <GroupHeader title="Single decks" />
      <div className="divide-y divide-border">
        {decks.map((deck) => (
          <Link
            key={deck}
            data-nav-item
            to={`/decks/${encodeURIComponent(deck)}/study`}
            className="flex items-center justify-between gap-3 px-4 py-3 bg-clip-padding transition-colors hover:bg-foreground/5"
          >
            <span className="font-medium">{deck}</span>
            <DueCountsBadges due={dueCounts[deck]} showTooltip={false} />
          </Link>
        ))}
      </div>
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
  dueCounts: Record<string, DueCounts>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
      <GroupHeader title={root} />
      <div className="divide-y divide-border">
        <Link
          data-nav-item
          to={`/decks/${encodeURIComponent(root)}/study`}
          className="flex items-center justify-between gap-3 px-4 py-3 bg-clip-padding transition-colors hover:bg-foreground/5"
        >
          <span className="font-medium">All decks</span>
          <DueCountsBadges due={dueCounts[root]} showTooltip={false} />
        </Link>
        {decks.map((deck) => {
          const parts = deck.split("::");
          const leaf = parts[parts.length - 1];
          // Show the path between the group root and the leaf, using " / " so
          // users never see Anki's "::" separator.
          const subPrefix =
            parts.length > 2 ? parts.slice(1, -1).join(" / ") + " / " : null;
          return (
            <Link
              key={deck}
              data-nav-item
              to={`/decks/${encodeURIComponent(deck)}/study`}
              className="flex items-center justify-between gap-3 px-4 py-3 bg-clip-padding transition-colors hover:bg-foreground/5"
            >
              <span className="flex items-center gap-2 font-medium">
                {/* A short rule marks the row as a subdeck, replacing the
                    left-indent so it reads clearly without Anki's "::" cue. */}
                <span
                  className="h-px w-4 shrink-0 bg-foreground/20"
                  aria-hidden
                />
                <span>
                  {subPrefix && (
                    <span className="text-foreground/40">{subPrefix}</span>
                  )}
                  {leaf}
                </span>
              </span>
              <DueCountsBadges due={dueCounts[deck]} showTooltip={false} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function DueCountsBadges({
  due,
  showTooltip = true,
}: {
  due: DueCounts | undefined;
  showTooltip?: boolean;
}) {
  if (!due || totalOf(due) === 0) {
    return (
      <CaretRight size={14} weight="bold" className="text-foreground/30" />
    );
  }
  return (
    // One neutral segmented pill: three equal columns over a fixed 6.5rem so the
    // counts line up under the New/Learn/Due header labels (same width + grid),
    // and a row with "0" stays aligned with one containing "12". An outer border
    // wraps the pill; divide-x draws the hairlines between each number.
    <span className="grid w-[6.5rem] grid-cols-3 divide-x divide-foreground/5 overflow-hidden rounded-full border border-border bg-foreground/[0.02] text-[11px] font-medium tabular-nums">
      <CountSegment value={due.new} label="New" showTooltip={showTooltip} />
      <CountSegment value={due.learn} label="Learning" showTooltip={showTooltip} />
      <CountSegment value={due.review} label="Due" showTooltip={showTooltip} />
    </span>
  );
}

function CountSegment({
  value,
  label,
  showTooltip,
}: {
  value: number;
  label: string;
  showTooltip: boolean;
}) {
  return (
    <span className="group/pill relative inline-flex w-full">
      <span
        className={`inline-flex w-full items-center justify-center px-1 py-1 leading-none ${
          value === 0 ? "text-foreground/30" : "text-foreground/70"
        }`}
      >
        {value}
      </span>
      {showTooltip && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background opacity-0 shadow-md transition-opacity duration-100 group-hover/pill:opacity-100"
        >
          {label}: {value}
        </span>
      )}
    </span>
  );
}
