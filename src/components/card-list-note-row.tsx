// One row of the card list: checkbox, display text, tag chips, actions menu.
// Memo'd — with a big deck, a selection change would otherwise re-render every
// row; the parent keeps every callback prop identity-stable so only the rows
// whose `selected`/`suspended` flags actually flip re-render.

import {
  memo,
  useEffect,
  useId,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Check } from "@phosphor-icons/react/dist/ssr/Check";
import { Image as ImageIcon } from "@phosphor-icons/react/dist/ssr/Image";
import { SpeakerHigh } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import { SpeakerSlash } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";
import type { Note } from "@/lib/types";
import { flagColor } from "@/lib/flags";
import { ActionsMenu } from "./actions-menu";
import { FlagPicker } from "./flag-picker";
import { stripCloze } from "@/lib/cloze";
import { stripHtml, truncate } from "@/lib/html-text";
import { noteDisplayFields } from "@/lib/note-fields";
import {
  extractImageFilenames,
  extractSoundFilenames,
  mediaFileExists,
  onPlayingFileChange,
  playAudio,
} from "@/lib/audio";

interface NoteDisplay {
  primary: string;
  secondary: string | null;
  /** Collection-media image filenames, for the image indicator chip. */
  images: string[];
  /** Sound filenames, in playback order, for the row's play button. */
  audio: string[];
}

// A note's list-row display: two HTML-stripped, truncated text lines plus the
// media (image + audio filenames) to preview inline. Both the stripHtml DOM
// parse and the media scan cost a parse per field and the list re-renders on
// every search keystroke, so the result is cached per note object (weakly — an
// edit or refetch replaces the note objects, dropping their stale entries with
// them).
const displayCache = new WeakMap<Note, NoteDisplay>();
function noteDisplay(note: Note): NoteDisplay {
  const cached = displayCache.get(note);
  if (cached !== undefined) return cached;
  const { primary, secondary } = noteDisplayFields(note);
  const display: NoteDisplay = {
    primary: truncate(stripCloze(stripHtml(primary)), 80),
    secondary: secondary ? truncate(stripCloze(stripHtml(secondary)), 80) : null,
    images: extractImageFilenames(note.fields),
    audio: extractSoundFilenames(note.fields),
  };
  displayCache.set(note, display);
  return display;
}

// A compact media indicator chip: a type icon plus, when there's more than one,
// a count. Shown in list rows because the plain-text display lines above strip
// a card's images and sounds out, so they'd otherwise be invisible. Wrapping
// element and interactivity are the caller's — the audio chip is a play button,
// the image chip a plain indicator.
function MediaChipContent({ icon, count }: { icon: ReactNode; count: number }) {
  return (
    <>
      {icon}
      {count > 1 && (
        <span className="font-medium tabular-nums">{count}</span>
      )}
    </>
  );
}

const MEDIA_CHIP_CLASS =
  "flex h-6 items-center gap-1 rounded-md border border-border px-1.5 text-foreground/55";

// Which audio chip owns the current playback. Highlighting is otherwise keyed
// by filename (via onPlayingFileChange), so a clip shared across notes — a
// common "correct.mp3" — would light up every chip that references it. Only one
// chip plays at a time, so we track the single owner and let just that chip
// light up. Each chip claims ownership on click; the store notifies chips so the
// previously-playing one clears.
let audioChipOwner: string | null = null;
const audioOwnerListeners = new Set<() => void>();
function claimAudioChipOwner(id: string): void {
  audioChipOwner = id;
  for (const listener of audioOwnerListeners) listener();
}
function subscribeAudioChipOwner(listener: () => void): () => void {
  audioOwnerListeners.add(listener);
  return () => audioOwnerListeners.delete(listener);
}

// The audio chip: a play button that runs the note's clips in sequence and,
// while this chip owns the playback, lights up with the same accent tint + pulse
// the study card uses (the shared `.audio-chip.is-playing` style), so the user
// can see which note is playing. Only mounted for notes that have audio, so the
// playback subscription is scoped to the rows that need it.
function AudioChip({ audio }: { audio: string[] }) {
  const id = useId();
  const [playing, setPlaying] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [missing, setMissing] = useState(false);
  // Gates the (network) existence probe below: flipped true on first
  // interaction so the check never runs on mount.
  const [probe, setProbe] = useState(false);
  useEffect(() => {
    // currentFile is one clip at a time; this note is "playing" whenever the
    // sounding file is one of its own. Ownership (below) narrows that to the
    // chip that started it, so a shared filename lights up only one chip.
    return onPlayingFileChange((file) => {
      setPlaying(file !== null && audio.includes(file));
    });
  }, [audio]);
  useEffect(
    () => subscribeAudioChipOwner(() => setIsOwner(audioChipOwner === id)),
    [id]
  );
  // Flag the chip as broken only when every referenced clip is confirmed
  // missing — a note with even one playable clip still plays, and an
  // undetermined result (null) never trips the broken state. Deferred until the
  // user reaches for the clip (hover/focus/click): the note list isn't
  // virtualized, so probing on mount would fire one getMediaFilesNames request
  // per clip across every row at once just to detect an uncommon state.
  useEffect(() => {
    if (!probe) return;
    let cancelled = false;
    Promise.all(audio.map((file) => mediaFileExists(file))).then((results) => {
      if (!cancelled) setMissing(results.every((r) => r === false));
    });
    return () => {
      cancelled = true;
    };
  }, [probe, audio]);

  if (missing) {
    return (
      <span
        className={`${MEDIA_CHIP_CLASS} text-foreground/40`}
        title={
          audio.length > 1 ? "Audio files missing" : "Audio file missing"
        }
        aria-label={
          audio.length > 1 ? "Audio files missing" : "Audio file missing"
        }
      >
        <MediaChipContent
          icon={<SpeakerSlash size={14} />}
          count={audio.length}
        />
      </span>
    );
  }

  const active = playing && isOwner;
  const label =
    audio.length > 1 ? `Play ${audio.length} audio clips` : "Play audio";
  return (
    <button
      type="button"
      onPointerEnter={() => setProbe(true)}
      onFocus={() => setProbe(true)}
      onClick={(e) => {
        e.stopPropagation();
        setProbe(true);
        claimAudioChipOwner(id);
        playAudio(audio);
      }}
      title={label}
      aria-label={label}
      className={`audio-chip ${MEDIA_CHIP_CLASS} transition-colors hover:bg-foreground/[0.06] hover:text-foreground${
        active ? " is-playing" : ""
      }`}
    >
      <MediaChipContent icon={<SpeakerHigh size={14} />} count={audio.length} />
    </button>
  );
}

interface NoteRowProps {
  note: Note;
  selected: boolean;
  suspended: boolean;
  /** The note's flag (0 = none), shown as the coloured left border. */
  flag: number;
  draggable: boolean;
  /** Open the note in the editor. */
  onOpen: (note: Note) => void;
  onCheckboxClick: (e: ReactMouseEvent, note: Note) => void;
  onToggleSuspend: (note: Note) => void;
  /** Set the note's flag (0 clears it). */
  onSetFlag: (note: Note, flag: number) => void;
  /** Open the move-to-deck dialog for the note. */
  onMove: (note: Note) => void;
  /** Open the delete confirmation for the note. */
  onDelete: (note: Note) => void;
  onDragStart: (e: ReactDragEvent, note: Note) => void;
  onDragEnd: () => void;
}

export const NoteRow = memo(function NoteRow({
  note,
  selected,
  suspended,
  flag,
  draggable,
  onOpen,
  onCheckboxClick,
  onToggleSuspend,
  onSetFlag,
  onMove,
  onDelete,
  onDragStart,
  onDragEnd,
}: NoteRowProps) {
  return (
    <div
      data-nav-item
      data-note-id={note.noteId}
      data-selected={selected || undefined}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => onDragStart(e, note)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(note)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(note);
        }
      }}
      className={`group relative flex select-none items-center gap-3 rounded-lg border px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)] cursor-pointer transition-[background-color] ${
        selected
          ? "border-foreground/40 bg-foreground/[0.05]"
          : "border-border hover:bg-foreground/[0.02]"
      } ${suspended && !selected ? "bg-foreground/[0.03]" : ""}`}
    >
      {/* Flag indicator — a 4px rounded pill down the row's left edge, inset 4px
         from the top, bottom, and left. Sits in the px-4 gutter, clear of the
         checkbox. */}
      {flag > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-1 left-1 top-1 w-1 rounded-full"
          style={{ background: flagColor(flag) ?? undefined }}
        />
      )}
      <button
        onClick={(e) => onCheckboxClick(e, note)}
        aria-label={selected ? "Deselect note" : "Select note"}
        aria-pressed={selected}
        className="relative z-10 -m-2 flex shrink-0 items-center justify-center self-start p-2"
      >
        <span
          className={`flex h-5 w-5 translate-y-[2px] items-center justify-center rounded border transition-all ${
            selected
              ? "border-foreground bg-foreground text-background"
              : "border-foreground/25 text-transparent group-hover:border-foreground/50"
          }`}
        >
          <Check size={13} weight="bold" />
        </span>
      </button>
      <div className={`flex-1 min-w-0 ${suspended ? "opacity-50" : ""}`}>
        {(() => {
          const { primary, secondary } = noteDisplay(note);
          return (
            <>
              <p className="text-sm font-medium">{primary}</p>
              {secondary && (
                <p className="text-sm text-foreground/50 mt-0.5">{secondary}</p>
              )}
            </>
          );
        })()}
        {note.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {note.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs text-foreground/60"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Media indicators: a type icon plus a count. Anki stores images and
         sounds as bare filenames in the fields, which the plain-text display
         lines above strip out — so a card's media would otherwise be invisible
         in the list. The audio chip doubles as a play button. */}
      {(() => {
        const { images, audio } = noteDisplay(note);
        if (images.length === 0 && audio.length === 0) return null;
        return (
          <div
            className={`flex shrink-0 items-center gap-1.5 text-xs ${
              suspended ? "opacity-50" : ""
            }`}
          >
            {images.length > 0 &&
              (() => {
                const imageLabel =
                  images.length > 1 ? `${images.length} images` : "1 image";
                return (
                  <span
                    className={MEDIA_CHIP_CLASS}
                    title={imageLabel}
                    aria-label={imageLabel}
                  >
                    <MediaChipContent
                      icon={<ImageIcon size={14} />}
                      count={images.length}
                    />
                  </span>
                );
              })()}
            {audio.length > 0 && <AudioChip audio={audio} />}
          </div>
        );
      })()}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <ActionsMenu
          label="Note actions"
          items={[
            {
              label: "Edit",
              kbd: "E",
              onSelect: () => onOpen(note),
            },
            {
              label: suspended ? "Unsuspend" : "Suspend",
              kbd: "S",
              onSelect: () => onToggleSuspend(note),
            },
            {
              label: "Move to deck…",
              kbd: "M",
              onSelect: () => onMove(note),
            },
            {
              label: "Delete",
              danger: true,
              onSelect: () => onDelete(note),
            },
            {
              render: (close) => (
                <FlagPicker
                  value={flag}
                  onSelect={(f) => {
                    onSetFlag(note, f);
                    close();
                  }}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
});
