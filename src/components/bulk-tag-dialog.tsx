import { useEffect, useState } from "react";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { useAllTags } from "@/hooks/use-all-tags";
import { TagInput } from "./tag-input";

/**
 * What a bulk tag operation changed, and how to reverse it. `action` is the
 * inverse op (removeTags undoes an add, addTags undoes a remove); `changes`
 * lists, per tag, exactly the notes that were actually modified so undo doesn't
 * touch notes that already had (or lacked) the tag.
 */
export interface TagChange {
  action: "addTags" | "removeTags";
  changes: { tag: string; noteIds: number[] }[];
}

interface BulkTagDialogProps {
  notes: Note[];
  onClose: () => void;
  /**
   * Called after tags are successfully changed instead of reloading the page.
   * Receives a reversible description of the change (null when nothing actually
   * changed). The callback owns closing the dialog and refreshing the view.
   */
  onTagged?: (change: TagChange | null) => void;
}

type Mode = "add" | "remove";

export function BulkTagDialog({ notes, onClose, onTagged }: BulkTagDialogProps) {
  useScrollLock();
  const [mode, setMode] = useState<Mode>("add");
  // Add mode: the tags being entered. Remove mode: the in-use tags the user has
  // unchecked, i.e. marked for removal.
  const [tags, setTags] = useState<string[]>([]);
  // Text typed into the tag field but not yet turned into a chip. Tracked so
  // clicking Apply still picks it up — pressing a button doesn't reliably blur
  // the input (and thus commit the text) on WebKit-based webviews.
  const [pending, setPending] = useState("");
  const [toRemove, setToRemove] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allTags = useAllTags();
  // Tags in use across the selection, with how many of the selected notes carry
  // each one — the checklist for Remove mode.
  const usage = new Map<string, number>();
  for (const n of notes) {
    for (const t of new Set(n.tags)) usage.set(t, (usage.get(t) ?? 0) + 1);
  }
  const inUse = [...usage.keys()].sort((a, b) => a.localeCompare(b));

  const count = notes.length;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setTags([]);
    setPending("");
    setToRemove(new Set());
    setError(null);
  }

  function toggleRemove(tag: string) {
    setToRemove((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  // Fold any uncommitted typed text into the add targets so it isn't lost when
  // applying without first pressing Enter.
  const pendingTag = pending.trim();
  const addTargets =
    pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags;
  const targets = mode === "add" ? addTargets : [...toRemove];
  const disabled = busy || targets.length === 0;

  async function handleApply() {
    if (targets.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // addTags only adds tags a note lacks, and removeTags only strips tags it
      // has, so both are no-ops where they don't apply — no client-side dedup
      // needed.
      await ankiFetch(mode === "add" ? "addTags" : "removeTags", {
        notes: notes.map((n) => n.noteId),
        tags: targets.join(" "),
      });
      // Record exactly which notes each tag actually applied to, so a later undo
      // reverses only the real changes.
      const changes = targets
        .map((tag) => ({
          tag,
          noteIds: notes
            .filter((n) =>
              mode === "add" ? !n.tags.includes(tag) : n.tags.includes(tag),
            )
            .map((n) => n.noteId),
        }))
        .filter((c) => c.noteIds.length > 0);
      const change: TagChange | null =
        changes.length === 0
          ? null
          : { action: mode === "add" ? "removeTags" : "addTags", changes };
      if (onTagged) {
        onTagged(change);
      } else {
        onClose();
        window.location.reload();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : mode === "add"
            ? "Failed to add tags"
            : "Failed to remove tags",
      );
      setBusy(false);
    }
  }

  const noun = count === 1 ? "1 Note" : `${count} Notes`;
  const title = mode === "add" ? `Add Tags to ${noun}` : `Remove Tags from ${noun}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg">
        <h3 className="mb-3 text-lg font-semibold">{title}</h3>

        <div className="mb-4 flex rounded-lg border border-foreground/15 p-0.5 text-sm">
          {(["add", "remove"] as const).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              disabled={busy}
              className={`flex-1 rounded-md px-3 py-1 capitalize transition-colors ${
                mode === m
                  ? "bg-foreground/10 font-medium"
                  : "text-foreground/60 hover:text-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "add" ? (
          <>
            <TagInput
              tags={tags}
              onChange={setTags}
              onInputChange={setPending}
              suggestions={allTags}
              autoFocus
              onSubmit={() => {
                if (!disabled) handleApply();
              }}
            />
            <p className="mt-2 text-xs text-foreground/50">
              Separate tags with commas.
            </p>
          </>
        ) : inUse.length === 0 ? (
          <p className="py-4 text-center text-sm text-foreground/50">
            The selected {count === 1 ? "note has" : "notes have"} no tags.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-foreground/50">
              Uncheck the tags you want to remove.
            </p>
            <ul className="max-h-64 overflow-auto rounded-lg border border-foreground/10">
              {inUse.map((tag) => {
                const removing = toRemove.has(tag);
                const used = usage.get(tag) ?? 0;
                return (
                  <li key={tag}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-foreground/5">
                      <input
                        type="checkbox"
                        checked={!removing}
                        onChange={() => toggleRemove(tag)}
                        disabled={busy}
                        className="size-4 accent-foreground"
                      />
                      <span
                        className={`flex-1 ${removing ? "text-red-500 line-through" : ""}`}
                      >
                        {tag}
                      </span>
                      <span className="text-xs text-foreground/40">
                        {used} {used === 1 ? "note" : "notes"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={disabled}
            className="rounded-lg border border-foreground/15 px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            {mode === "add"
              ? busy
                ? "Adding…"
                : "Add"
              : busy
                ? "Removing…"
                : toRemove.size > 0
                  ? `Remove ${toRemove.size}`
                  : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
