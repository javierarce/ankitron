// The card list's header row: the note count (or "n selected"), the sort
// dropdown, and the bulk action buttons that appear once a selection exists.
// Select-all and clear-selection are keyboard-only (Cmd+A / Esc) — no buttons,
// to leave room for the action row (see BulkActionBar for its overflow logic).

import { BulkActionBar } from "./card-list-bulk-actions";
import { SORT_OPTIONS, type SortMode } from "@/hooks/use-note-search";

interface CardListToolbarProps {
  /** Selected note count; 0 shows the plain count + sort views instead. */
  selectedCount: number;
  /** Whether a query is active — the count reads "x of y" then. */
  searching: boolean;
  filteredCount: number;
  /** Notes in the current segment scope, the "y" of "x of y". */
  scopedCount: number;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  allSelectedSuspended: boolean;
  /** Open the sequential editor over the selection. */
  onEditSelection: () => void;
  onBulkSuspend: (suspend: boolean) => void;
  /** Apply a flag (0 clears it) to every selected note. */
  onBulkFlag: (flag: number) => void;
  onBulkMove: () => void;
  onBulkTag: () => void;
  onBulkDelete: () => void;
}

export function CardListToolbar({
  selectedCount,
  searching,
  filteredCount,
  scopedCount,
  sortMode,
  onSortChange,
  allSelectedSuspended,
  onEditSelection,
  onBulkSuspend,
  onBulkFlag,
  onBulkMove,
  onBulkTag,
  onBulkDelete,
}: CardListToolbarProps) {
  const selectionActive = selectedCount > 0;
  return (
    <div
      data-bulk-toolbar
      className="mb-4 flex h-9 items-center justify-between gap-3"
    >
      <div className="flex shrink-0 items-center gap-3">
        {selectionActive ? (
          <p className="whitespace-nowrap text-sm font-medium">
            {selectedCount} {selectedCount === 1 ? "note" : "notes"} selected
          </p>
        ) : (
          <p className="text-sm text-foreground/50">
            {searching
              ? `${filteredCount} of ${scopedCount} ${scopedCount === 1 ? "note" : "notes"}`
              : `${scopedCount} ${scopedCount === 1 ? "note" : "notes"}`}
          </p>
        )}
      </div>
      {!selectionActive && (
        <select
          value={sortMode}
          onChange={(e) => onSortChange(e.target.value as SortMode)}
          aria-label="Sort notes"
          className="rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground/70 hover:bg-foreground/5 focus:outline-none focus:border-foreground/30 transition-colors cursor-pointer"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {selectionActive && (
        <BulkActionBar
          allSelectedSuspended={allSelectedSuspended}
          onEditSelection={onEditSelection}
          onBulkSuspend={onBulkSuspend}
          onBulkFlag={onBulkFlag}
          onBulkMove={onBulkMove}
          onBulkTag={onBulkTag}
          onBulkDelete={onBulkDelete}
        />
      )}
    </div>
  );
}
