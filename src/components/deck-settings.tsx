import { useCallback, useEffect, useState } from "react";
import {
  countDecksSharingOptions,
  getDeckAudioFlag,
  setDeckAudioFlag,
} from "@/lib/audio";
import { getDeckPrefs, setDeckPref } from "@/lib/deck-prefs";
import {
  getCachedVoices,
  isConfigured,
  listVoices,
  type ElevenLabsVoice,
} from "@/lib/elevenlabs";
import { CARD_TYPE_OPTIONS, DEFAULT_CARD_TYPE } from "@/lib/card-types";

interface DeckSettingsProps {
  deckName: string;
}

export function DeckSettings({ deckName }: DeckSettingsProps) {
  return (
    <>
      <DeckPreferences deckName={deckName} />
      <AudioOptions deckName={deckName} />
    </>
  );
}

/**
 * Ankitron's own per-deck preferences: these apply to this deck and nothing
 * else. Anki has no field for either, so they're stored locally (see
 * lib/deck-prefs).
 */
function DeckPreferences({ deckName }: DeckSettingsProps) {
  // Read once per deck: the store is synchronous, and re-reading on every
  // render would fight the local state below.
  const [noteType, setNoteType] = useState(
    () => getDeckPrefs(deckName).noteType ?? DEFAULT_CARD_TYPE,
  );
  const [voiceId, setVoiceId] = useState(
    () => getDeckPrefs(deckName).ttsVoiceId ?? "",
  );
  const [voices, setVoices] = useState<ElevenLabsVoice[]>(() =>
    getCachedVoices(),
  );
  // Only worth showing the voice row once ElevenLabs has a key; without one
  // there's nothing to choose from and the row is just a dead end.
  const ttsReady = isConfigured();

  // Seeded from the cache above so the picker is usable immediately; this
  // refreshes it. Failures leave the cached list (or none) in place.
  useEffect(() => {
    if (!ttsReady) return;
    let cancelled = false;
    listVoices()
      .then((fetched) => {
        if (!cancelled && fetched.length > 0) setVoices(fetched);
      })
      .catch(() => {
        // Keep whatever the cache gave us.
      });
    return () => {
      cancelled = true;
    };
  }, [ttsReady]);

  function changeNoteType(value: string) {
    setNoteType(value);
    // The built-in default needs no stored preference — clearing it keeps the
    // deck out of storage entirely.
    setDeckPref(
      deckName,
      "noteType",
      value === DEFAULT_CARD_TYPE ? undefined : value,
    );
  }

  function changeVoice(value: string) {
    setVoiceId(value);
    setDeckPref(deckName, "ttsVoiceId", value || undefined);
  }

  return (
    <div className="space-y-4 py-4">
      <div>
        <label
          htmlFor="deck-note-type"
          className="mb-2 block text-sm font-medium"
        >
          New notes start as
        </label>
        <select
          id="deck-note-type"
          value={noteType}
          onChange={(e) => changeNoteType(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-foreground/30 focus:outline-none"
        >
          {CARD_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {ttsReady && (
        <div>
          <label
            htmlFor="deck-tts-voice"
            className="mb-2 block text-sm font-medium"
          >
            Text-to-speech voice
          </label>
          <select
            id="deck-tts-voice"
            value={voiceId}
            onChange={(e) => changeVoice(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-foreground/30 focus:outline-none"
          >
            <option value="">Last voice used</option>
            {voices.map((v) => (
              <option key={v.voiceId} value={v.voiceId}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/**
 * Anki's own audio options for this deck. They live on the deck's config — a
 * preset any number of decks can share — so the only thing worth saying is when
 * a change reaches beyond this deck. The preset's name isn't shown: Ankitron has
 * no concept of presets anywhere else, so naming one would point at something
 * the user can't see or act on from here.
 */
function AudioOptions({ deckName }: DeckSettingsProps) {
  const [sharedWith, setSharedWith] = useState(0);

  useEffect(() => {
    let cancelled = false;
    countDecksSharingOptions(deckName).then((count) => {
      // Null (Anki unreachable) and 1 (the deck's own preset) both mean nothing
      // to warn about.
      if (!cancelled) setSharedWith(count === null ? 0 : count - 1);
    });
    return () => {
      cancelled = true;
    };
  }, [deckName]);

  return (
    <div className="py-4">
      <p className="mb-3 text-sm font-medium">Audio</p>
      <div className="space-y-2">
        <AudioToggle
          deckName={deckName}
          flag="autoplay"
          label="Play card audio automatically during study"
        />
        <AudioToggle
          deckName={deckName}
          flag="replayq"
          label="Play the question's audio again with the answer"
        />
      </div>
      {sharedWith > 0 && (
        <p className="mt-3 text-xs text-foreground/50">
          Changing these also affects {sharedWith} other{" "}
          {sharedWith === 1 ? "deck" : "decks"}.
        </p>
      )}
    </div>
  );
}

function AudioToggle({
  deckName,
  flag,
  label,
}: {
  deckName: string;
  flag: "autoplay" | "replayq";
  label: string;
}) {
  // null while loading or when Anki is unreachable — the toggle stays disabled.
  const [value, setValue] = useState<boolean | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    getDeckAudioFlag(deckName, flag).then((loaded) => {
      if (!cancelled) setValue(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [deckName, flag]);

  useEffect(load, [load]);

  async function toggle() {
    if (value === null) return;
    const next = !value;
    setValue(next);
    try {
      await setDeckAudioFlag(deckName, flag, next);
    } catch {
      setValue(!next);
    }
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={value ?? false}
        disabled={value === null}
        onChange={toggle}
        className="accent-foreground"
      />
      {label}
    </label>
  );
}
