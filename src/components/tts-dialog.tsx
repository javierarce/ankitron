import { useEffect, useRef, useState } from "react";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import {
  ElevenLabsVoice,
  generateSpeech,
  getCachedVoices,
  getLastVoiceId,
  getModelId,
  listVoices,
  setLastVoiceId,
  storeGeneratedSpeech,
} from "@/lib/elevenlabs";

interface TtsDialogProps {
  /** The text the user selected in the editor. */
  text: string;
  /** Called with the stored media filename once the user inserts. */
  onInsert: (filename: string) => void;
  onClose: () => void;
}

/** Decode base64 mp3 into a playable object URL for the preview step. */
function base64ToObjectUrl(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

export function TtsDialog({ text, onInsert, onClose }: TtsDialogProps) {
  useScrollLock();
  const modelId = getModelId();

  // Seed the picker from the cache so it's usable immediately, then refresh.
  const [voices, setVoices] = useState<ElevenLabsVoice[]>(() =>
    getCachedVoices()
  );
  const [voiceId, setVoiceId] = useState<string>(() => {
    const cached = getCachedVoices();
    const last = getLastVoiceId();
    return (
      (last && cached.some((v) => v.voiceId === last) ? last : cached[0]?.voiceId) ??
      ""
    );
  });

  const [generating, setGenerating] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The generated clip: base64 to store on Insert, plus an object URL to play.
  // Cleared whenever the voice changes so the preview never lags behind it.
  const [audio, setAudio] = useState<{ base64: string; url: string } | null>(
    null
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Refresh the voice list once on open. Falls back to the cached list (already
  // shown) if Anki/ElevenLabs is unreachable or no key is set.
  useEffect(() => {
    let cancelled = false;
    listVoices()
      .then((fetched) => {
        if (cancelled || fetched.length === 0) return;
        setVoices(fetched);
        setVoiceId((current) =>
          current && fetched.some((v) => v.voiceId === current)
            ? current
            : fetched[0].voiceId
        );
      })
      .catch((e) => {
        if (!cancelled && getCachedVoices().length === 0) {
          setError(
            e instanceof Error ? e.message : "Could not load voices."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !inserting) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inserting, onClose]);

  // Revoke the object URL when it's replaced or the dialog unmounts so blobs
  // don't leak across regenerations.
  useEffect(() => {
    return () => {
      if (audio) URL.revokeObjectURL(audio.url);
    };
  }, [audio]);

  function selectVoice(id: string) {
    setVoiceId(id);
    // A clip belongs to the voice it was made with; drop it so Insert can't
    // store audio from a voice the user has since changed away from.
    setAudio(null);
    setError(null);
  }

  async function handleGenerate() {
    if (!voiceId || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const base64 = await generateSpeech(text, voiceId, modelId);
      setAudio({ base64, url: base64ToObjectUrl(base64) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate audio.");
    } finally {
      setGenerating(false);
    }
  }

  function handlePlay() {
    audioRef.current?.play().catch(() => {});
  }

  async function handleInsert() {
    if (!audio || inserting) return;
    setInserting(true);
    setError(null);
    try {
      const filename = await storeGeneratedSpeech(
        audio.base64,
        text,
        voiceId,
        modelId
      );
      setLastVoiceId(voiceId);
      onInsert(filename);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save the audio. Make sure Anki is running."
      );
      setInserting(false);
    }
  }

  const noVoices = voices.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !inserting) onClose();
      }}
    >
      <div className="mx-4 w-full max-w-md rounded-xl border border-foreground/10 bg-background p-6 shadow-lg">
        <h3 className="mb-1 text-lg font-semibold">Generate audio</h3>
        <p className="mb-4 line-clamp-3 text-sm text-foreground/50">
          “{text}”
        </p>

        {noVoices ? (
          <p className="mb-4 text-sm text-foreground/60">
            No voices available. Add your ElevenLabs API key in Settings and
            fetch your voices.
          </p>
        ) : (
          <>
            <label className="mb-1 block text-xs text-foreground/50">
              Voice
            </label>
            <select
              value={voiceId}
              onChange={(e) => selectVoice(e.target.value)}
              disabled={generating || inserting}
              autoFocus
              className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none disabled:opacity-60"
            >
              {voices.map((v) => (
                <option key={v.voiceId} value={v.voiceId}>
                  {v.name}
                </option>
              ))}
            </select>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || inserting || !voiceId}
                className="rounded-lg border border-foreground/15 px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
              >
                {generating
                  ? "Generating…"
                  : audio
                    ? "Regenerate"
                    : "Generate"}
              </button>
              {audio && (
                <button
                  type="button"
                  onClick={handlePlay}
                  disabled={inserting}
                  className="rounded-lg border border-foreground/15 px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
                >
                  ▶ Play
                </button>
              )}
              {/* Hidden element drives playback; the Play button calls into it. */}
              {audio && <audio ref={audioRef} src={audio.url} />}
            </div>
          </>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={inserting}
            className="rounded-lg px-4 py-2 text-sm text-foreground/60 transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleInsert}
            disabled={!audio || inserting}
            className="rounded-lg border border-foreground/15 px-4 py-2 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
          >
            {inserting ? "Inserting…" : "Insert"}
          </button>
        </div>
      </div>
    </div>
  );
}
