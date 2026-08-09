import { useState, useEffect, useRef } from "react";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CardEditor } from "./card-editor";
import { TagInput } from "./tag-input";
import { Note } from "@/lib/types";
import { CLOZE_OPEN_RE, hasClozePattern } from "@/lib/cloze";
import { basicFieldKeys, isClozeNote, orderedFieldNames } from "@/lib/note-fields";
import {
  addNote,
  addTagsToNotes,
  deleteNotes,
  updateNote,
  type NewNote,
} from "@/lib/notes";
import { CLOZE_TYPED_MODEL, ensureClozeTypedModel } from "@/lib/cloze-typed-model";
import {
  CARD_TYPE_OPTIONS,
  defaultCardTypeFor,
  type CardType,
} from "@/lib/card-types";
import { isLeech } from "@/lib/leeches";
import { useAllTags } from "@/hooks/use-all-tags";
import { useDeckNames } from "@/hooks/use-deck-names";
import { ModalDialog } from "./modal-dialog";
import { MoveToDeckPanel } from "./move-to-deck-panel";
import { ActionsMenu, type ActionsMenuItem } from "./actions-menu";

// Anki's stock note type that generates a forward and a reverse card per note.
const BASIC_REVERSED_MODEL = "Basic (and reversed card)";

// The note types whose fields the curated Front/Back and Text/Back Extra
// editors understand. Anything else (a shared deck's own note type) is edited
// generically: its real fields, in order, under their real names.
const KNOWN_MODELS = new Set<string>([
  "Basic",
  BASIC_REVERSED_MODEL,
  "Cloze",
  CLOZE_TYPED_MODEL,
]);

interface CardFormProps {
  deckName: string;
  note?: Note;
  onClose: () => void;
  /**
   * Called after a successful save instead of reloading the page. The
   * callback owns closing the form and refreshing whatever is on screen.
   * Receives the updated note when fields/tags/deck actually changed, so a
   * sequential editor can keep its list in sync without a full reload; it's
   * called with no argument when nothing was written (a no-op save).
   * A save never moves the note between decks — that's the actions menu, and
   * it applies immediately — so a same-id result is always patchable in place.
   */
  onSaved?: (updated?: Note) => void;
  /**
   * When editing a selection one card at a time, the current position in the
   * run. Drives the "n / total" progress and the prev/next arrows.
   */
  position?: { index: number; total: number };
  /** Go to the previous card in the run, discarding any edits. */
  onPrev?: () => void;
  /** Skip to the next card (or finish) without saving the current one. */
  onSkip?: () => void;
  /**
   * Whether the note's cards are suspended, for the actions menu's label.
   * Only meaningful alongside onToggleSuspend.
   */
  suspended?: boolean;
  /** Toggle suspension on every card of this note. */
  onToggleSuspend?: () => void;
  /**
   * Reset the note's cards to new — Anki's Forget. Already confirmed: the menu
   * asks in place rather than stacking a dialog over this one. Resolves to
   * whether the reset landed, so a failure isn't reported as a success — the
   * call fails softly (it toasts and returns) rather than throwing.
   */
  onForget?: () => boolean | Promise<boolean>;
  /**
   * Move the note to `deck`, creating it first when `isNew`. Applied straight
   * away, like the rest of the menu — not folded into the save.
   */
  onMove?: (deck: string, isNew: boolean) => void | Promise<void>;
  /** Delete the current note. Confirmed inline, as with onForget. */
  onDelete?: () => void | Promise<void>;
  /**
   * Set while a dialog (e.g. the delete confirmation) is stacked on top, so the
   * form ignores Escape and backdrop clicks and lets that dialog handle them.
   */
  blocked?: boolean;
}

export function CardForm({
  deckName,
  note,
  onClose,
  onSaved,
  position,
  onPrev,
  onSkip,
  suspended,
  onToggleSuspend,
  onForget,
  onMove,
  onDelete,
  blocked,
}: CardFormProps) {
  const noteFields = note?.fields ?? {};

  function extractValue(field: unknown): string {
    if (!field) return "";
    if (typeof field === "string") return field;
    if (typeof field === "object" && field !== null && "value" in field) {
      return String((field as { value: unknown }).value);
    }
    return "";
  }

  const isEdit = !!note;
  const initialType: CardType = note
    ? note.modelName === CLOZE_TYPED_MODEL
      ? "ClozeTyped"
      : isClozeNote(note)
        ? "Cloze"
        : note.modelName === BASIC_REVERSED_MODEL
          ? "BasicReversed"
          : "Basic"
    : defaultCardTypeFor(deckName);

  const [cardType, setCardType] = useState<CardType>(initialType);

  function changeCardType(newType: CardType) {
    if (newType === cardType) return;
    const wasCloze = cardType === "Cloze" || cardType === "ClozeTyped";
    const willBeCloze = newType === "Cloze" || newType === "ClozeTyped";
    if (!wasCloze && willBeCloze) {
      if (front.trim() && !clozeText.trim()) setClozeText(front);
      if (back.trim() && !backExtra.trim()) setBackExtra(back);
    } else if (wasCloze && !willBeCloze) {
      if (clozeText.trim() && !front.trim()) setFront(clozeText);
      if (backExtra.trim() && !back.trim()) setBack(backExtra);
    }
    setCardType(newType);
  }

  // Basic and "Basic (and reversed)" share the same Front/Back editor; only
  // the cloze types swap in the Text/Back Extra fields.
  const isBasicForm = cardType === "Basic" || cardType === "BasicReversed";

  // Basic fields, keyed by Anki's field `order` (see basicFieldKeys). The
  // initial* snapshots let us dirty-check on save so we never rewrite (and
  // re-sync) a card the user merely paged through without touching.
  const { frontKey, backKey } = basicFieldKeys(noteFields);
  const initialFront = extractValue(noteFields[frontKey]);
  const initialBack = extractValue(noteFields[backKey]);
  const [front, setFront] = useState(initialFront);
  const [back, setBack] = useState(initialBack);

  // Cloze fields
  const textField = noteFields["Text"];
  const backExtraField = noteFields["Back Extra"];
  const initialClozeText = extractValue(textField);
  const initialBackExtra = extractValue(backExtraField);
  const [clozeText, setClozeText] = useState(initialClozeText);
  const [backExtra, setBackExtra] = useState(initialBackExtra);

  // Editing a note built on a custom note type (the deck author's own, not one
  // of our four canonical types): we can't map it onto Front/Back, so we edit
  // its real fields in order under their real names. Adding always uses the
  // curated types, so this only applies to existing notes.
  const customModel = isEdit && !!note && !KNOWN_MODELS.has(note.modelName);
  const customFields = customModel
    ? orderedFieldNames(noteFields).map((name) => ({
        name,
        initial: extractValue(noteFields[name]),
      }))
    : [];
  const [customValues, setCustomValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(customFields.map((f) => [f.name, f.initial])),
  );

  const initialTags = note?.tags ?? [];
  const [tags, setTags] = useState<string[]>(initialTags);
  const allTags = useAllTags();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once a Forget has landed on this note, for the footer's status line.
  const [forgotten, setForgotten] = useState(false);

  // For the move panel in the actions menu (edit only — adds file into the deck
  // they were opened on). Null while the list loads; the picker handles that.
  const allDecks = useDeckNames({ enabled: isEdit });

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    modalRef.current?.focus();
    function tryFocusEditor() {
      if (cancelled || !modalRef.current) return;
      const editable = modalRef.current.querySelector<HTMLElement>('[contenteditable="true"]');
      if (editable) editable.focus();
      else requestAnimationFrame(tryFocusEditor);
    }
    tryFocusEditor();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const isClozeForm = !isBasicForm;

    if (customModel) {
      const first = customFields[0];
      if (first && !(customValues[first.name] ?? "").trim()) {
        setError(`${first.name} is required.`);
        return;
      }
    } else if (isBasicForm) {
      if (!front.trim() || !back.trim()) {
        setError("Front and back are required.");
        return;
      }
    } else {
      if (!clozeText.trim()) {
        setError("Text is required.");
        return;
      }
      if (!hasClozePattern(clozeText)) {
        setError("Text must contain at least one cloze deletion, e.g. {{c1::word}}");
        return;
      }
    }

    setSaving(true);
    setError(null);

    // Set when a save actually writes something, so the caller can refresh.
    // Left undefined for a no-op save (paged-through, untouched card).
    let savedNote: Note | undefined;

    try {
      if (cardType === "ClozeTyped") {
        await ensureClozeTypedModel();
      }


      const modelName =
        cardType === "ClozeTyped"
          ? CLOZE_TYPED_MODEL
          : cardType === "Cloze"
            ? "Cloze"
            : cardType === "BasicReversed"
              ? BASIC_REVERSED_MODEL
              : "Basic";

      if (isEdit && cardType === initialType) {
        // Only write what actually changed. Walking a selection and hitting
        // "Update Card" on every card would otherwise bump `mod` and re-sync
        // each one even when untouched.
        const fieldsChanged = customModel
          ? customFields.some((f) => (customValues[f.name] ?? "") !== f.initial)
          : isClozeForm
            ? clozeText !== initialClozeText || backExtra !== initialBackExtra
            : front !== initialFront || back !== initialBack;
        const tagsChanged =
          [...tags].sort().join("\u0000") !==
          [...initialTags].sort().join("\u0000");

        if (fieldsChanged || tagsChanged) {
          // One updateNote call writes fields and tags together. Tags are
          // replaced wholesale — the previous removeTags-per-tag loop plus
          // addTags took N+1 requests and could fail midway, leaving the note
          // stripped of all its tags.
          const payload: {
            id: number;
            fields?: Record<string, string>;
            tags?: string[];
          } = { id: note.noteId };
          if (fieldsChanged) {
            let fields: Record<string, string>;
            if (customModel) {
              // Only send the fields that actually changed.
              fields = {};
              for (const f of customFields) {
                const value = customValues[f.name] ?? "";
                if (value !== f.initial) fields[f.name] = value;
              }
            } else if (isClozeForm) {
              fields = { Text: clozeText, "Back Extra": backExtra };
            } else {
              fields = { [frontKey]: front, [backKey]: back };
            }
            payload.fields = fields;
          }
          if (tagsChanged) payload.tags = tags;
          await updateNote(payload);
        }
        if (fieldsChanged || tagsChanged) {
          const updatedFields = { ...note.fields };
          if (customModel) {
            for (const f of customFields) {
              if (updatedFields[f.name])
                updatedFields[f.name] = {
                  ...updatedFields[f.name],
                  value: customValues[f.name] ?? "",
                };
            }
          } else if (isClozeForm) {
            if (updatedFields.Text)
              updatedFields.Text = { ...updatedFields.Text, value: clozeText };
            if (updatedFields["Back Extra"])
              updatedFields["Back Extra"] = {
                ...updatedFields["Back Extra"],
                value: backExtra,
              };
          } else {
            if (updatedFields[frontKey])
              updatedFields[frontKey] = { ...updatedFields[frontKey], value: front };
            if (updatedFields[backKey])
              updatedFields[backKey] = { ...updatedFields[backKey], value: back };
          }
          // Stamp the edit time locally: the "Recently modified" sort reads
          // `mod`, and an in-place patch never refetches Anki's value, so
          // without this the edited note would keep its old list position.
          savedNote = {
            ...note,
            fields: updatedFields,
            tags,
            mod: Math.floor(Date.now() / 1000),
          };
        }
      } else {
        const noteData: NewNote = isClozeForm
          ? {
              deckName,
              modelName,
              fields: { Text: clozeText, "Back Extra": backExtra },
              tags,
            }
          : {
              deckName,
              modelName,
              fields: { Front: front, Back: back },
              tags,
            };

        const noteId = await addNote(noteData);
        if (tags.length > 0 && noteId) {
          await addTagsToNotes([noteId], tags);
        }
        if (isEdit) {
          await deleteNotes([note.noteId]);
          // A type change replaces the note with a new id. Report the rebuilt
          // note so a sequential editor can refresh on close and repoint its
          // run at the new id for correct back-navigation.
          savedNote = {
            ...note,
            noteId,
            // The new note has fresh card ids we haven't fetched; drop the
            // deleted note's so a later deck change falls back to findCards.
            cards: undefined,
            modelName,
            tags,
            fields: isClozeForm
              ? {
                  Text: { value: clozeText, order: 0 },
                  "Back Extra": { value: backExtra, order: 1 },
                }
              : {
                  Front: { value: front, order: 0 },
                  Back: { value: back, order: 1 },
                },
          };
        }
      }
      if (onSaved) {
        onSaved(savedNote);
      } else {
        onClose();
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save card");
    } finally {
      setSaving(false);
    }
  }

  // Only what the call site wired up: the add form gets none of these and
  // renders no menu at all. Forget and Delete arm the footer's inline
  // confirmation rather than firing — see the footer for why it isn't a dialog.
  const noteActions: ActionsMenuItem[] = [];
  if (onToggleSuspend) {
    noteActions.push({
      label: suspended ? "Unsuspend" : "Suspend",
      disabled: saving,
      onSelect: onToggleSuspend,
    });
  }
  if (onForget) {
    noteActions.push({
      label: "Forget",
      disabled: saving,
      // Asked and answered inside the popup, where the click happened — the
      // menu is inside this modal, so a dialog here would be a second one on
      // top of the first.
      confirm: {
        message:
          "Reset this note's scheduling? It loses its interval and ease and comes back as a new card.",
        confirmLabel: "Forget",
      },
      onSelect: async () => {
        // Forget changes nothing visible in the form — same fields, same text —
        // so say what happened, or the click looks like it did nothing. Only
        // on success: a failed reset already toasts, and a "Scheduling reset"
        // line sitting under that toast would contradict it.
        if (await onForget()) setForgotten(true);
      },
    });
  }
  if (onMove) {
    noteActions.push({
      label: "Move to deck…",
      disabled: saving,
      // A whole picker rather than a yes/no, but the same idea as the
      // confirmations above: the step happens inside the popup. Moving is rare
      // enough that a permanent deck field made the form heavier than it was
      // worth — and a tree that size was the heaviest thing on it.
      panel: (close) => (
        <MoveToDeckPanel
          decks={allDecks}
          currentDeck={deckName}
          onMove={onMove}
          onClose={close}
        />
      ),
    });
  }
  if (onDelete) {
    noteActions.push({
      label: "Delete",
      danger: true,
      disabled: saving,
      confirm: {
        message: "Delete this note? This can't be undone.",
        confirmLabel: "Delete",
      },
      onSelect: onDelete,
    });
  }

  return (
    <ModalDialog
      ariaLabel={isEdit ? "Edit Note" : "Add Note"}
      width="2xl"
      scrollable
      blocked={blocked}
      onClose={onClose}
      panelRef={modalRef}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">
            {isEdit ? "Edit Note" : "Add Note"}
          </h3>
          {/* Says WHY this note is in front of you — without it, a walkthrough
              of a deck's leeches is just a pile of anonymous notes to edit.
              Reads the live tag state, not the saved note, so clearing the tag
              here (the way a dealt-with leech is retired) updates it at once. */}
          {isEdit && isLeech({ tags }) && (
            <span
              title="Anki flagged this note as a leech — you forget it far more often than the rest. Rewrite it, split it, or delete it; clear the tag once you've dealt with it."
              className="rounded-full border border-amber-500/40 bg-amber-500/5 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              Leech
            </span>
          )}
          {/* Suspension is otherwise invisible in here — the row in the list
              says it with opacity, which the editor has no equivalent of. Reads
              the live prop, so toggling Suspend from the menu flips it at once
              (and a Forget clears it, since Anki's reset unsuspends). Neutral
              rather than amber: it's a state the user chose, not a problem. */}
          {isEdit && suspended && (
            <span
              title="These cards are suspended — they won't come up in study until you unsuspend them."
              className="rounded-full border border-border bg-foreground/5 px-2 py-0.5 text-xs font-medium text-foreground/60"
            >
              Suspended
            </span>
          )}
        </div>
        {/* Trailing edge of the header: where you are in the run, and what you
            can do to this note. The counter sits with the arrows that change
            it, and keeps them still — right-aligned, the group grows leftward
            as the number widens (9/10 → 10/10), so the buttons never slide out
            from under the pointer mid-walkthrough. */}
        <div className="flex items-center gap-3">
          {/* A run of one has nowhere to page to — the counter would read
              "1 / 1" beside two permanently disabled arrows. */}
          {position && position.total > 1 && (
            <div className="flex items-center gap-3">
              <span className="text-sm tabular-nums text-foreground/40">
                {position.index + 1} / {position.total}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={saving || position.index === 0}
                  aria-label="Previous note"
                  className="rounded-md p-1.5 text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <CaretLeft size={18} weight="bold" />
                </button>
                <button
                  type="button"
                  onClick={onSkip}
                  disabled={saving || position.index === position.total - 1}
                  aria-label="Next note"
                  className="rounded-md p-1.5 text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <CaretRight size={18} weight="bold" />
                </button>
              </div>
            </div>
          )}
          {/* Actions on the NOTE, as opposed to the two footer buttons, which
              act on this editing session. Same set and same shape as the row's
              kebab, at the same trailing edge, so the two don't diverge. */}
          {noteActions.length > 0 && (
            <ActionsMenu
              label="Note actions"
              items={noteActions}
              menuClassName="min-w-[150px]"
              triggerClassName={(open) =>
                `rounded-md p-1.5 text-foreground/50 transition-colors hover:bg-foreground/5 hover:text-foreground ${
                  open ? "bg-foreground/5 text-foreground" : ""
                }`
              }
              iconSize={18}
            />
          )}
        </div>
      </div>

      {isEdit && cardType !== initialType && (
        <p className="mb-4 text-xs text-amber-600 dark:text-amber-500">
          Changing the note type creates a new note and resets its review history.
        </p>
      )}

      <form
        onSubmit={handleSubmit}
        onKeyDown={(e) => {
          // Tab is trapped inside the panel by the ModalDialog shell.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.requestSubmit();
          }
        }}
        className="space-y-4"
      >
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground/70">
            Type
          </label>
          {customModel ? (
            // A custom note type can't be remapped onto our curated types
            // without losing fields, so the type is shown but not editable.
            <div className="w-full rounded-md border border-border bg-foreground/[0.03] px-2 py-1.5 text-sm text-foreground/70">
              {note?.modelName}
            </div>
          ) : (
            <select
              value={cardType}
              onChange={(e) => changeCardType(e.target.value as CardType)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-foreground/30 focus:outline-none"
            >
              {CARD_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {customModel ? (
          customFields.map((f) => {
            const isClozeField =
              f.name === "Text" ||
              CLOZE_OPEN_RE.test(customValues[f.name] ?? "");
            return (
              <div key={f.name}>
                <label className="mb-1.5 block text-sm font-medium text-foreground/70">
                  {f.name}
                </label>
                <CardEditor
                  content={customValues[f.name] ?? ""}
                  onChange={(v) =>
                    setCustomValues((prev) => ({ ...prev, [f.name]: v }))
                  }
                  placeholder={`${f.name}…`}
                  clozeMode={isClozeField}
                  deckName={deckName}
                />
              </div>
            );
          })
        ) : isBasicForm ? (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground/70">
                Front
              </label>
              <CardEditor
                content={front}
                onChange={setFront}
                placeholder="Front side..."
                deckName={deckName}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground/70">
                Back
              </label>
              <CardEditor
                content={back}
                onChange={setBack}
                placeholder="Back side..."
                deckName={deckName}
              />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground/70">
                Text
              </label>
              <CardEditor
                content={clozeText}
                onChange={setClozeText}
                placeholder="The capital of {{c1::France}} is {{c2::Paris}}."
                clozeMode
                deckName={deckName}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground/70">
                Back Extra <span className="font-normal text-foreground/40">(optional)</span>
              </label>
              <CardEditor
                content={backExtra}
                onChange={setBackExtra}
                placeholder="Extra info shown on the back..."
                deckName={deckName}
              />
            </div>
          </>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground/70">
            Tags
          </label>
          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />
        </div>


        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex items-center justify-between gap-3 pt-2">
          {/* Forget changes nothing visible in the form, so without this the
              click looks like it did nothing at all. Otherwise this side stays
              empty: the footer is for the two session buttons, and the note's
              own actions live up in the header. */}
          <div>
            {forgotten && (
              <p className="text-sm text-foreground/50">
                Scheduling reset — this note comes back as new.
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm text-foreground/60 hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
            >
              {saving ? "Saving..." : isEdit ? "Update Note" : "Add Note"}
            </button>
          </div>
        </div>
      </form>
    </ModalDialog>
  );
}
