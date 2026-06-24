import { storeAudioBytes } from "./audio";

/** True when running inside Tauri's webview — the ElevenLabs commands proxy
 * through the Rust backend, so they only exist there (not in browser dev). */
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** An error from the ElevenLabs commands. `kind` is "auth" when the key itself
 * is bad (rejected / missing permission) — safe to discard — or "transient" for
 * offline / rate-limit / server errors, where the key should be kept. */
export class ElevenLabsError extends Error {
  kind: "auth" | "transient";
  constructor(kind: "auth" | "transient", message: string) {
    super(message);
    this.name = "ElevenLabsError";
    this.kind = kind;
  }
}

async function invokeTauri<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isTauri) {
    throw new Error("ElevenLabs is only available in the desktop app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    // The TTS/voices commands reject with a structured { kind, message };
    // normalise to an Error so callers keep using e.message, with e.kind
    // available for classification. Other commands reject with a plain string.
    if (e && typeof e === "object" && "message" in e) {
      const kind = (e as { kind?: string }).kind === "auth" ? "auth" : "transient";
      throw new ElevenLabsError(kind, String((e as { message: unknown }).message));
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
}

export interface ElevenLabsModel {
  id: string;
  label: string;
}

/** Models offered in Settings. multilingual_v2 is the default: best quality and
 * it speaks the non-English text that fills language-learning decks. The
 * turbo/flash models trade a little quality for lower latency and cost. */
export const ELEVENLABS_MODELS: ElevenLabsModel[] = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2 (best quality)" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5 (faster, cheaper)" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5 (fastest, cheapest)" },
];

export const DEFAULT_MODEL_ID = ELEVENLABS_MODELS[0].id;

const MODEL_KEY = "elevenlabs-model";
const LAST_VOICE_KEY = "elevenlabs-last-voice";
const VOICES_CACHE_KEY = "elevenlabs-voices";
const CONFIGURED_KEY = "elevenlabs-configured";

// --- Settings (model + cached voices live in localStorage; the API key lives
// in the OS keychain, reached only through the Rust commands below) ----------

export function getModelId(): string {
  if (typeof localStorage === "undefined") return DEFAULT_MODEL_ID;
  const saved = localStorage.getItem(MODEL_KEY);
  return ELEVENLABS_MODELS.some((m) => m.id === saved)
    ? (saved as string)
    : DEFAULT_MODEL_ID;
}

export function setModelId(id: string): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(MODEL_KEY, id);
}

/** The voice the dialog should preselect — the one used last, so a deck's
 * usual voice is one tap away across notes. */
export function getLastVoiceId(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(LAST_VOICE_KEY);
}

export function setLastVoiceId(voiceId: string): void {
  if (typeof localStorage !== "undefined")
    localStorage.setItem(LAST_VOICE_KEY, voiceId);
}

/** Voices cached from the last fetch, so the dialog opens instantly without a
 * round-trip. Settings refreshes this; an empty/parse-failed cache returns []. */
export function getCachedVoices(): ElevenLabsVoice[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(VOICES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setCachedVoices(voices: ElevenLabsVoice[]): void {
  if (typeof localStorage !== "undefined")
    localStorage.setItem(VOICES_CACHE_KEY, JSON.stringify(voices));
}

// --- API key (keychain-backed, via Rust) ------------------------------------

/**
 * Whether a key is configured — backed by a plain (non-secret) localStorage
 * flag, deliberately NOT a keychain read. Reading the secret triggers macOS's
 * "<app> wants to use your confidential information" prompt; checking this on
 * every editor open would surface that dialog constantly. The keychain is only
 * touched when the user actually generates audio or saves a key. False outside
 * the desktop app, where TTS doesn't run anyway.
 */
export function isConfigured(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(CONFIGURED_KEY) === "1";
}

/** Save the key, or clear it when `key` is empty. Mirrors the keychain write
 * into the configured flag so the editor knows without reading the secret. */
export async function setApiKey(key: string): Promise<void> {
  await invokeTauri<void>("set_elevenlabs_api_key", { key });
  if (typeof localStorage !== "undefined") {
    if (key.trim()) localStorage.setItem(CONFIGURED_KEY, "1");
    else localStorage.removeItem(CONFIGURED_KEY);
  }
}

// --- Voices & generation ----------------------------------------------------

interface RawVoicesResponse {
  voices?: { voice_id?: string; name?: string }[];
}

/** Fetch the account's voices and refresh the local cache. */
export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const raw = await invokeTauri<RawVoicesResponse>("elevenlabs_voices");
  const voices: ElevenLabsVoice[] = (raw.voices ?? [])
    .filter((v): v is { voice_id: string; name?: string } => !!v.voice_id)
    .map((v) => ({ voiceId: v.voice_id, name: v.name ?? v.voice_id }));
  setCachedVoices(voices);
  return voices;
}

/** Generate speech and return the audio as base64 (mp3). */
export function generateSpeech(
  text: string,
  voiceId: string,
  modelId: string
): Promise<string> {
  return invokeTauri<string>("elevenlabs_tts", {
    text,
    voiceId,
    modelId,
  });
}

/** Stable, content-derived basename so regenerating the same text+voice+model
 * reuses the stored file instead of accumulating duplicates in Anki's media
 * folder (paired with storeMediaFile's deleteExisting:false). djb2 hash. */
export function ttsFilename(
  text: string,
  voiceId: string,
  modelId: string
): string {
  const seed = `${text} ${voiceId} ${modelId}`;
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  }
  return `tts-${(hash >>> 0).toString(36)}.mp3`;
}

/**
 * Generate speech for `text`, store it in Anki's media folder, and return the
 * filename to drop into a `[sound:…]` tag. `base64` is the already-generated
 * audio from the preview step, so Insert doesn't re-call ElevenLabs.
 */
export async function storeGeneratedSpeech(
  base64: string,
  text: string,
  voiceId: string,
  modelId: string
): Promise<string> {
  return storeAudioBytes(base64, ttsFilename(text, voiceId, modelId));
}
