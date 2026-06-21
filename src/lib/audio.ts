import { ankiFetch } from "./anki-fetch";
import { NoteField } from "./types";

/** An `[sound:file]` reference inside a raw note field. */
const SOUND_TAG_RE = /\[sound:([^\]]+)\]/g;

/** The `[anki:play:q:0]` placeholders Anki's renderer substitutes for sound
 * tags in the question/answer HTML it returns over AnkiConnect. */
const AV_PLACEHOLDER_RE = /\[anki:play:([qa]):(\d+)\]/g;

/** Anki marks the start of the answer-only portion with this divider. */
const ANSWER_HR_RE = /<hr\b[^>]*\bid=["']?answer["']?[^>]*>/i;

/** Ordered `[sound:…]` filenames across a note's raw fields. Fields are
 * walked in Anki's field order, which is also the order the stock templates
 * render them in — `resolveCardAudio` relies on that to line filenames up
 * with the renderer's placeholder indexes. */
export function extractSoundFilenames(
  fields: Record<string, NoteField>
): string[] {
  const ordered = Object.values(fields).sort((a, b) => a.order - b.order);
  const files: string[] = [];
  for (const field of ordered) {
    for (const match of field.value.matchAll(SOUND_TAG_RE)) {
      files.push(match[1]);
    }
  }
  return files;
}

/** Remove sound tags and play placeholders, for plain-text previews. */
export function stripSoundTags(text: string): string {
  return text.replace(SOUND_TAG_RE, "").replace(AV_PLACEHOLDER_RE, "");
}

export interface CardAudio {
  questionHtml: string;
  answerHtml: string;
  /** Files referenced on the question side, in playback order. */
  questionFiles: string[];
  /** All files referenced on the answer side, in playback order. */
  answerFiles: string[];
}

function countPlaceholders(html: string): number {
  return [...html.matchAll(AV_PLACEHOLDER_RE)].length;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const SPEAKER_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 4.6v14.8a1 1 0 0 1-1.63.78L6.6 16.4H4a2 2 0 0 1-2-2v-4.8a2 2 0 0 1 2-2h2.6l4.77-3.78A1 1 0 0 1 13 4.6Z"/><path d="M16.5 8.2a1 1 0 0 1 1.4.2 6 6 0 0 1 0 7.2 1 1 0 1 1-1.6-1.2 4 4 0 0 0 0-4.8 1 1 0 0 1 .2-1.4Z"/><path d="M19.7 5.3a1 1 0 0 1 1.4.1 10 10 0 0 1 0 13.2 1 1 0 1 1-1.5-1.3 8 8 0 0 0 0-10.6 1 1 0 0 1 .1-1.4Z"/></svg>';

/** Replace each mappable placeholder with an inline play button (clicks are
 * handled by delegation on the card body); unmappable ones are dropped. */
function renderSide(
  html: string,
  fileForIndex: (index: number) => string | undefined
): { html: string; files: string[] } {
  const files: string[] = [];
  const rendered = html.replace(AV_PLACEHOLDER_RE, (_match, _side, index) => {
    const file = fileForIndex(Number(index));
    if (!file) return "";
    files.push(file);
    return `<button type="button" class="audio-tag" data-audio-file="${escapeAttr(file)}" title="Play audio" aria-label="Play audio">${SPEAKER_SVG}</button>`;
  });
  return { html: rendered, files };
}

/**
 * Map the `[anki:play:…]` placeholders in a card's rendered HTML back to the
 * note's sound filenames (AnkiConnect exposes the placeholders but not the
 * filenames behind them).
 *
 * Question placeholders appear in field order, so q:i is `sounds[i]`. The
 * answer side re-indexes everything as a:N: when the template embeds
 * {{FrontSide}} (the default), the question's sounds come first and a:i is
 * `sounds[i]`; otherwise the answer's own sounds follow the question's in
 * field order, so a:i is `sounds[questionCount + i]`. Templates that render
 * fields out of order can mismap — those placeholders just play the wrong
 * file or are dropped, never break the card.
 */
export function resolveCardAudio(
  question: string,
  answer: string,
  sounds: string[]
): CardAudio {
  const questionCount = countPlaceholders(question);
  const q = renderSide(question, (i) => sounds[i]);

  // Placeholders count as question replays only when they sit before the
  // answer divider — without a divider there is no FrontSide portion.
  const hrMatch = answer.match(ANSWER_HR_RE);
  const frontPortion =
    hrMatch && hrMatch.index !== undefined ? answer.slice(0, hrMatch.index) : "";
  const replayed = countPlaceholders(frontPortion);
  const offset = replayed > 0 ? 0 : questionCount;
  const a = renderSide(answer, (i) => sounds[offset + i]);

  return {
    questionHtml: q.html,
    answerHtml: a.html,
    questionFiles: q.files,
    answerFiles: a.files,
  };
}

// --- Playback ---------------------------------------------------------------

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  spx: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  webm: "audio/webm",
  "3gp": "audio/3gpp",
};

function mimeFor(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  return AUDIO_MIME[ext] ?? "audio/mpeg";
}

/** filename → object-URL promise; kept for the app's lifetime (card audio is
 * small and decks repeat files heavily). */
const urlCache = new Map<string, Promise<string | null>>();

async function getAudioUrl(filename: string): Promise<string | null> {
  let pending = urlCache.get(filename);
  if (!pending) {
    pending = (async () => {
      try {
        const data = await ankiFetch<string | false>("retrieveMediaFile", {
          filename,
        });
        if (!data) return null;
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        return URL.createObjectURL(new Blob([bytes], { type: mimeFor(filename) }));
      } catch {
        return null;
      }
    })();
    urlCache.set(filename, pending);
  }
  const url = await pending;
  // Don't cache misses — the file may appear after an edit, or Anki may have
  // been unreachable.
  if (url === null) urlCache.delete(filename);
  return url;
}

let currentAudio: HTMLAudioElement | null = null;
// Incremented on every stop/new playback so an in-flight sequence can tell
// it has been superseded.
let playToken = 0;

export function stopAudio(): void {
  playToken++;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

/** Play files one after another, cancelling any playback in progress. */
export async function playAudio(files: string[]): Promise<void> {
  stopAudio();
  const token = playToken;
  for (const file of files) {
    const url = await getAudioUrl(file);
    if (token !== playToken) return;
    if (!url) continue;
    await new Promise<void>((resolve) => {
      const audio = new Audio(url);
      currentAudio = audio;
      audio.onended = () => resolve();
      audio.onpause = () => resolve();
      audio.onerror = () => resolve();
      // play() rejects when the webview blocks autoplay before the first
      // user gesture — treat the file as done rather than stalling the queue.
      audio.play().catch(() => resolve());
    });
    if (token !== playToken) return;
  }
}

// --- Autoplay ---------------------------------------------------------------
//
// During study Ankitron drives Anki's real reviewer, so automatic playback is
// Anki's doing, governed by the deck's "Don't play audio automatically"
// option. These helpers surface that option. Note that deck configs are
// shared presets: changing it affects every deck using the same preset, and
// studying in Anki desktop directly.

export async function getDeckAutoplay(deckName: string): Promise<boolean | null> {
  try {
    const config = await ankiFetch<{ autoplay?: boolean }>("getDeckConfig", {
      deck: deckName,
    });
    return config?.autoplay ?? true;
  } catch {
    return null;
  }
}

export async function setDeckAutoplay(
  deckName: string,
  autoplay: boolean
): Promise<void> {
  // saveDeckConfig replaces the whole config object, so round-trip it.
  const config = await ankiFetch<Record<string, unknown>>("getDeckConfig", {
    deck: deckName,
  });
  config.autoplay = autoplay;
  await ankiFetch("saveDeckConfig", { config });
}

// --- Storing ----------------------------------------------------------------

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000; // String.fromCharCode argument-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Store an audio file in Anki's media folder and return the filename to
 * reference in a `[sound:…]` tag. With deleteExisting=false Anki renames on
 * collision instead of overwriting, and reports the name it actually used.
 */
export async function storeAudioFile(file: File): Promise<string> {
  const data = await fileToBase64(file);
  // Square brackets would terminate the [sound:…] tag early; the rest are
  // unsafe on some filesystems Anki syncs to.
  const filename = file.name.replace(/[[\]<>:"/\\|?*]/g, "-");
  const stored = await ankiFetch<string>("storeMediaFile", {
    filename,
    data,
    deleteExisting: false,
  });
  return typeof stored === "string" && stored ? stored : filename;
}
