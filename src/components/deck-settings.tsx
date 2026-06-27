import { useEffect, useState } from "react";
import { getDeckAutoplay, setDeckAutoplay } from "@/lib/audio";

interface DeckSettingsProps {
  deckName: string;
}

export function DeckSettings({ deckName }: DeckSettingsProps) {
  // null while loading or when Anki is unreachable — the toggle stays disabled.
  const [autoplay, setAutoplay] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDeckAutoplay(deckName).then((value) => {
      if (!cancelled) setAutoplay(value);
    });
    return () => {
      cancelled = true;
    };
  }, [deckName]);

  async function handleAutoplayToggle() {
    if (autoplay === null) return;
    const next = !autoplay;
    setAutoplay(next);
    try {
      await setDeckAutoplay(deckName, next);
    } catch {
      setAutoplay(!next);
    }
  }

  return (
    <div className="py-4">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={autoplay ?? false}
          disabled={autoplay === null}
          onChange={handleAutoplayToggle}
          className="accent-foreground"
        />
        Play card audio automatically during study
      </label>
      <p className="mt-1 text-xs text-foreground/50">
        Audio can always be played manually with the inline buttons or{" "}
        <kbd>R</kbd>.
      </p>
    </div>
  );
}
