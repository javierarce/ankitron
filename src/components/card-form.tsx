import { useState, useEffect, useMemo, useRef } from "react";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { Trash } from "@phosphor-icons/react/dist/ssr/Trash";
import { CardEditor } from "./card-editor";
import { TagInput } from "./tag-input";
import { Note } from "@/lib/types";
import { ankiFetch } from "@/lib/anki-fetch";
import { CLOZE_OPEN_RE, hasClozePattern } from "@/lib/cloze";
import { compareDeckPaths, deckDepth, deckLeaf, formatDeckPath } from "@/lib/deck";
import { basicFieldKeys, isClozeNote, orderedFieldNames } from "@/lib/note-fields";
import { moveNotesToDeck } from "@/lib/notes";
import { CLOZE_TYPED_MODEL, ensureClozeTypedModel } from "@/lib/cloze-typed-model";
import { useAllTags } from "@/hooks/use-all-tags";
import { useDeckNames } from "@/hooks/use-deck-names";
import { ModalDialog } from "./modal-dialog";

type CardType = "Basic" | "BasicReversed" | "Cloze" | "ClozeTyped";

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

const CARD_TYPE_OPTIONS: { value: CardType; label: string }[] = [
  { value: "Basic", label: "Basic" },
  { value: "BasicReversed", label: "Basic (and reversed)" },
  { value: "Cloze", label: "Cloze" },
  { value: "ClozeTyped", label: "Cloze (typed)" },
];

// "Create a new deck" sentinel. The leading space is deliberate: Anki trims
// deck names, so no real deck path can equal this, keeping it collision-proof.
const NEW_DECK = " new";

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
   * `opts.movedTo` names the destination deck when the save moved the note,
   * so a deck-scoped list knows an in-place patch isn't enough.
   */
  onSaved?: (updated?: Note, opts?: { movedTo?: string }) => void;
  /**
   * When editing a selection one card at a time, the current position in the
   * run. Drives the "n / total" progress and the prev/next arrows.
   */
  position?: { index: number; total: number };
  /** Go to the previous card in the run, discarding any edits. */
  onPrev?: () => void;
  /** Skip to the next card (or finish) without saving the current one. */
  onSkip?: () => void;
  /** Delete the current card. Renders a Delete button in the footer. */
  onDelete?: () => void;
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
    : "Basic";

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

  // Only the edit form shows the deck selector; adds always target deckName.
  // Until the list lands (or if the fetch fails) the selector still offers the
  // note's current deck, and that deck is always present in the list.
  const allDecks = useDeckNames({ enabled: isEdit });
  const decks = useMemo(() => {
    if (!allDecks) return [deckName];
    const all = allDecks.includes(deckName) ? allDecks : [deckName, ...allDecks];
    return [...all].sort(compareDeckPaths);
  }, [allDecks, deckName]);
  const [targetDeck, setTargetDeck] = useState(deckName);
  const [newDeck, setNewDeck] = useState("");

  const creatingDeck = targetDeck === NEW_DECK;
  const destDeck = creatingDeck ? newDeck.trim() : targetDeck;

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

    if (creatingDeck && !destDeck) {
      setError("Enter a name for the new deck.");
      return;
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

      if (creatingDeck) {
        await ankiFetch("createDeck", { deck: destDeck });
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
        const deckChanged = destDeck !== deckName;

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
          await ankiFetch("updateNote", { note: payload });
        }
        if (deckChanged) {
          await moveNotesToDeck([note], destDeck);
        }
        if (fieldsChanged || tagsChanged || deckChanged) {
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
        const noteData = isClozeForm
          ? {
              deckName: destDeck,
              modelName,
              fields: { Text: clozeText, "Back Extra": backExtra },
              tags,
            }
          : {
              deckName: destDeck,
              modelName,
              fields: { Front: front, Back: back },
              tags,
            };

        const noteId = await ankiFetch<number>("addNote", { note: noteData });
        if (tags.length > 0 && noteId) {
          await ankiFetch("addTags", {
            notes: [noteId],
            tags: tags.join(" "),
          });
        }
        if (isEdit) {
          await ankiFetch("deleteNotes", { notes: [note.noteId] });
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
        onSaved(
          savedNote,
          isEdit && destDeck !== deckName ? { movedTo: destDeck } : undefined,
        );
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
          {position && (
            <span className="text-sm tabular-nums text-foreground/40">
              {position.index + 1} / {position.total}
            </span>
          )}
        </div>
        {position && (
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
        )}
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
              <CardEditor content={front} onChange={setFront} placeholder="Front side..." />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground/70">
                Back
              </label>
              <CardEditor content={back} onChange={setBack} placeholder="Back side..." />
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
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground/70">
                Back Extra <span className="font-normal text-foreground/40">(optional)</span>
              </label>
              <CardEditor content={backExtra} onChange={setBackExtra} placeholder="Extra info shown on the back..." />
            </div>
          </>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground/70">
            Tags
          </label>
          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />
        </div>

        {isEdit && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground/70">
              Deck
            </label>
            <select
              value={targetDeck}
              onChange={(e) => setTargetDeck(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-foreground/30 focus:outline-none"
            >
              {decks.map((d) => (
                <option key={d} value={d}>
                  {/* Indent by depth and show only the leaf so the list reads
                      as a tree instead of exposing "::" paths. The indent uses
                      non-breaking spaces — the browser strips leading ASCII
                      spaces from <option> labels. */}
                  {"  ".repeat(deckDepth(d)) + deckLeaf(d)}
                </option>
              ))}
              <option value={NEW_DECK}>+ New deck…</option>
            </select>
            {creatingDeck && (
              <input
                type="text"
                value={newDeck}
                onChange={(e) => setNewDeck(e.target.value)}
                placeholder="New deck name"
                className="mt-2 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm placeholder:text-foreground/40 focus:border-foreground/30 focus:outline-none"
              />
            )}
            {destDeck && destDeck !== deckName && (
              <p className="mt-1 text-xs text-foreground/50">
                The note will be moved to {formatDeckPath(destDeck)} when you
                save.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex items-center justify-between gap-3 pt-2">
          <div>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                <Trash size={16} weight="bold" />
                Delete
              </button>
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
