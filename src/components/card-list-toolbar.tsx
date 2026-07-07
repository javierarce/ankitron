// The card list's header row: the note count (or "n selected" with select-all/
// clear), the sort dropdown, and the bulk action buttons that appear once a
// selection exists.

import { Checks } from "@phosphor-icons/react/dist/ssr/Checks";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { Pause } from "@phosphor-icons/react/dist/ssr/Pause";
import { Play } from "@phosphor-icons/react/dist/ssr/Play";
import { FolderSimple } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import { PencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { Tag } from "@phosphor-icons/react/dist/ssr/Tag";
import { X } from "@phosphor-icons/react/dist/ssr/X";
import { Kbd } from "./actions-menu";
import { SORT_OPTIONS, type SortMode } from "@/hooks/use-note-search";

interface CardListToolbarProps {
  /** Selected note count; 0 shows the plain count + sort views instead. */
  selectedCount: number;
  /** Whether a query is active — the count reads "x of y" then. */
  searching: boolean;
  filteredCount: number;
  /** Notes in the current segment scope, the "y" of "x of y". */
  scopedCount: number;
  allVisibleSelected: boolean;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  allSelectedSuspended: boolean;
  /** Open the sequential editor over the selection. */
  onEditSelection: () => void;
  onBulkSuspend: (suspend: boolean) => void;
  onBulkMove: () => void;
  onBulkTag: () => void;
  onBulkDelete: () => void;
}

export function CardListToolbar({
  selectedCount,
  searching,
  filteredCount,
  scopedCount,
  allVisibleSelected,
  onSelectAllVisible,
  onClearSelection,
  sortMode,
  onSortChange,
  allSelectedSuspended,
  onEditSelection,
  onBulkSuspend,
  onBulkMove,
  onBulkTag,
  onBulkDelete,
}: CardListToolbarProps) {
  const selectionActive = selectedCount > 0;
  return (
    <div className="mb-4 flex h-9 items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {selectionActive ? (
          <>
            <p className="text-sm font-medium">
              {selectedCount} {selectedCount === 1 ? "note" : "notes"} selected
            </p>
            {!allVisibleSelected && (
              <button
                onClick={onSelectAllVisible}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-foreground/50 hover:text-foreground transition-colors"
              >
                <Checks size={15} weight="bold" />
                Select all
              </button>
            )}
            <button
              onClick={onClearSelection}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm text-foreground/50 hover:text-foreground transition-colors"
            >
              <X size={14} weight="bold" />
              Clear
            </button>
          </>
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
        <div className="flex items-center gap-2">
            <button
              onClick={onEditSelection}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
            >
              <PencilSimple size={16} weight="bold" />
              Edit
              <Kbd>E</Kbd>
            </button>
            <button
              onClick={() => onBulkSuspend(!allSelectedSuspended)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
            >
              {allSelectedSuspended ? (
                <>
                  <Play size={16} weight="bold" />
                  Unsuspend
                </>
              ) : (
                <>
                  <Pause size={16} weight="bold" />
                  Suspend
                </>
              )}
              <Kbd>S</Kbd>
            </button>
            <button
              onClick={onBulkMove}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
            >
              <FolderSimple size={16} weight="bold" />
              Move
              <Kbd>M</Kbd>
            </button>
            <button
              onClick={onBulkTag}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 transition-colors"
            >
              <Tag size={16} weight="bold" />
              Tag
              <Kbd>T</Kbd>
            </button>
            <button
              onClick={onBulkDelete}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <Trash size={16} weight="bold" />
              Delete
            </button>
        </div>
      )}
    </div>
  );
}
