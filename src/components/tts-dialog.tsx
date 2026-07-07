import { useEffect, useRef, useState } from "react";
import { ModalDialog } from "./modal-dialog";
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

  const panelRef = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);

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

  // Keep focus inside the dialog so keystrokes can't reach the editor/form
  // behind it. This re-runs as the dialog's state changes — notably when
  // generating/inserting disable the focused control, which drops focus and
  // would otherwise let it drift back to the editor. We only grab focus when
  // it's outside the dialog (or parked on the panel), never from a control the
  // user is using. focus() no-ops on a disabled <select>, so fall back to the
  // always-focusable panel while a request is in flight.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    if (!panel.contains(active) || active === panel) {
      const select = selectRef.current;
      if (select && !select.disabled) select.focus();
      else panel.focus();
    }
  }, [voices.length, generating, inserting, audio]);

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

  // The shell portals to <body> so the dialog isn't a DOM descendant of the
  // card <form>. Otherwise its <select> is a form control and pressing Enter
  // would trigger the browser's implicit form submission, saving and closing
  // the card.
  return (
    <ModalDialog
      title="Generate audio"
      titleClassName="mb-1"
      busy={inserting}
      onClose={onClose}
      panelRef={panelRef}
      footer={{
        confirmLabel: "Insert",
        busyLabel: "Inserting…",
        confirmDisabled: !audio,
        onConfirm: handleInsert,
      }}
    >
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
            ref={selectRef}
            value={voiceId}
            onChange={(e) => selectVoice(e.target.value)}
            disabled={generating || inserting}
            autoFocus
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none disabled:opacity-60"
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
              className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
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
                className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
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
    </ModalDialog>
  );
}
