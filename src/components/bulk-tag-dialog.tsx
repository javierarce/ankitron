import { useEffect, useState } from "react";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { useAllTags } from "@/hooks/use-all-tags";
import { TagInput } from "./tag-input";

/**
 * A single reversible tag operation: `action` is the inverse op needed to undo
 * what was done (removeTags undoes an add, addTags undoes a remove), and
 * `noteIds` lists exactly the notes that were actually changed so undo doesn't
 * touch notes that already had (or lacked) the tag.
 */
export interface TagOp {
  action: "addTags" | "removeTags";
  tag: string;
  noteIds: number[];
}

/**
 * What a tag edit changed, as a flat list of reversible ops. One Apply can both
 * add and remove tags, so a change may mix addTags and removeTags ops.
 */
export interface TagChange {
  ops: TagOp[];
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

// What the user wants to happen to an in-use tag. "keep" is the default no-op:
// for a tag on every selected note it means leave it; for a partially-applied
// tag it means don't touch the notes either way.
type TagState = "add" | "remove" | "keep";

export function BulkTagDialog({ notes, onClose, onTagged }: BulkTagDialogProps) {
  useScrollLock();
  // New tags typed into the field, to be added to every selected note.
  const [tags, setTags] = useState<string[]>([]);
  // Text typed into the tag field but not yet turned into a chip. Tracked so
  // clicking Apply still picks it up — pressing a button doesn't reliably blur
  // the input (and thus commit the text) on WebKit-based webviews.
  const [pending, setPending] = useState("");
  // Per in-use tag, the user's intent. Absent means "keep" (the default).
  const [tagStates, setTagStates] = useState<Map<string, TagState>>(
    () => new Map(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allTags = useAllTags();
  const count = notes.length;

  // Tags in use across the selection, with how many of the selected notes carry
  // each one — the editable checklist.
  const usage = new Map<string, number>();
  for (const n of notes) {
    for (const t of new Set(n.tags)) usage.set(t, (usage.get(t) ?? 0) + 1);
  }
  const inUse = [...usage.keys()].sort((a, b) => a.localeCompare(b));
  const hasPartial = inUse.some((t) => {
    const u = usage.get(t) ?? 0;
    return u > 0 && u < count;
  });

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  // Click cycles a tag's state. A fully-applied tag toggles keep⇄remove; a
  // partially-applied one cycles keep→add→remove→keep so you can add it to the
  // rest, strip it entirely, or leave the notes as they are.
  function cycleTag(tag: string, isPartial: boolean) {
    setTagStates((prev) => {
      const next = new Map(prev);
      const cur = next.get(tag) ?? "keep";
      let resolved: TagState;
      if (isPartial) {
        resolved = cur === "keep" ? "add" : cur === "add" ? "remove" : "keep";
      } else {
        resolved = cur === "remove" ? "keep" : "remove";
      }
      if (resolved === "keep") next.delete(tag);
      else next.set(tag, resolved);
      return next;
    });
  }

  // Fold any uncommitted typed text into the new tags so it isn't lost when
  // applying without first pressing Enter.
  const pendingTag = pending.trim();
  const newTags =
    pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags;

  // Resolve the full set of tags to add and to remove, merging typed-in tags
  // with checklist intent (a tag in both lands in one set, deduped).
  const adds = new Set<string>(newTags);
  const removes = new Set<string>();
  for (const [tag, state] of tagStates) {
    if (state === "add") adds.add(tag);
    else if (state === "remove") removes.add(tag);
  }
  const disabled = busy || (adds.size === 0 && removes.size === 0);

  async function handleApply() {
    if (adds.size === 0 && removes.size === 0) return;
    const addList = [...adds];
    const removeList = [...removes];
    const noteIds = notes.map((n) => n.noteId);
    setBusy(true);
    setError(null);
    try {
      // addTags only adds tags a note lacks, and removeTags only strips tags it
      // has, so both are no-ops where they don't apply — no client-side dedup
      // needed.
      if (addList.length > 0) {
        await ankiFetch("addTags", { notes: noteIds, tags: addList.join(" ") });
      }
      if (removeList.length > 0) {
        await ankiFetch("removeTags", {
          notes: noteIds,
          tags: removeList.join(" "),
        });
      }
      // Record exactly which notes each tag actually applied to, with the
      // inverse action, so a later undo reverses only the real changes.
      const ops: TagOp[] = [];
      for (const tag of addList) {
        const ids = notes
          .filter((n) => !n.tags.includes(tag))
          .map((n) => n.noteId);
        if (ids.length > 0) ops.push({ action: "removeTags", tag, noteIds: ids });
      }
      for (const tag of removeList) {
        const ids = notes
          .filter((n) => n.tags.includes(tag))
          .map((n) => n.noteId);
        if (ids.length > 0) ops.push({ action: "addTags", tag, noteIds: ids });
      }
      const change: TagChange | null = ops.length === 0 ? null : { ops };
      if (onTagged) {
        onTagged(change);
      } else {
        onClose();
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update tags");
      setBusy(false);
    }
  }

  const noun = count === 1 ? "Note" : `${count} Notes`;
  const title = `Edit Tags · ${noun}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg">
        <h3 className="mb-3 text-lg font-semibold">{title}</h3>

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
          Type to add new tags. Separate with commas.
        </p>

        {inUse.length > 0 && (
          <div className="mt-4">
            <ul className="max-h-64 overflow-auto rounded-lg border border-foreground/10">
              {inUse.map((tag) => {
                const used = usage.get(tag) ?? 0;
                const isPartial = used > 0 && used < count;
                const state = tagStates.get(tag) ?? "keep";
                const checked = state === "add" || (state === "keep" && !isPartial);
                const indeterminate = state === "keep" && isPartial;
                // Preview how many notes will carry the tag once applied.
                const projected =
                  state === "remove" ? 0 : state === "add" ? count : used;
                return (
                  <li key={tag}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-foreground/5">
                      <input
                        type="checkbox"
                        checked={checked}
                        ref={(el) => {
                          if (el) el.indeterminate = indeterminate;
                        }}
                        onChange={() => cycleTag(tag, isPartial)}
                        disabled={busy}
                        className="size-4 accent-foreground"
                      />
                      <span
                        className={`flex-1 ${
                          state === "remove"
                            ? "text-red-500 line-through"
                            : state === "add"
                              ? "text-green-600 dark:text-green-500"
                              : ""
                        }`}
                      >
                        {tag}
                      </span>
                      <span className="text-xs tabular-nums text-foreground/40">
                        {projected} of {count}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-foreground/50">
              {hasPartial
                ? "Uncheck to remove a tag, or check a half-filled one to add it to every note."
                : "Uncheck the tags you want to remove."}
            </p>
          </div>
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
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
