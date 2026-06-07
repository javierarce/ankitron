import { useEffect, useMemo, useState } from "react";
import { SpeakerHigh } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import {
  DeckLanguages,
  getDeckLanguages,
  setDeckLanguage,
  speak,
} from "@/lib/deck-settings";

interface DeckSettingsProps {
  deckName: string;
}

interface LanguageOption {
  lang: string;
  label: string;
}

function normalizeLang(raw: string): string {
  return raw.replace("_", "-");
}

function describeLanguage(lang: string): string {
  try {
    const display = new Intl.DisplayNames([navigator.language || "en"], {
      type: "language",
    });
    const name = display.of(lang);
    if (name && name !== lang) return `${name} (${lang})`;
  } catch {
    // fall through
  }
  return lang;
}

function buildOptions(voices: SpeechSynthesisVoice[]): LanguageOption[] {
  const seen = new Set<string>();
  const options: LanguageOption[] = [];
  for (const v of voices) {
    const lang = normalizeLang(v.lang);
    if (!lang || seen.has(lang)) continue;
    seen.add(lang);
    options.push({ lang, label: describeLanguage(lang) });
  }
  options.sort((a, b) => a.label.localeCompare(b.label));
  return options;
}

const SAMPLES: Record<string, string> = {
  de: "Hallo, das ist ein Test.",
  es: "Hola, esto es una prueba.",
  en: "Hello, this is a test.",
  it: "Ciao, questo è un test.",
  fr: "Bonjour, ceci est un test.",
};

function sampleFor(lang: string): string {
  return SAMPLES[lang.split("-")[0]] ?? "Hello, this is a test.";
}

export function DeckSettings({ deckName }: DeckSettingsProps) {
  const [mounted, setMounted] = useState(false);
  const [languages, setLanguages] = useState<DeckLanguages>({
    primary: null,
    secondary: null,
  });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    setMounted(true);
    setLanguages(getDeckLanguages(deckName));

    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, [deckName]);

  const options = useMemo(() => buildOptions(voices), [voices]);
  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  function handleChange(slot: "primary" | "secondary", value: string) {
    const lang = value || null;
    setLanguages((prev) => ({ ...prev, [slot]: lang }));
    setDeckLanguage(deckName, slot, lang);
  }

  function handleTest(slot: "primary" | "secondary") {
    const lang = languages[slot];
    if (!lang) return;
    speak(sampleFor(lang), lang);
  }

  if (!mounted) return <div className="mt-16 h-32" />;

  return (
    <section className="mt-16 border-t border-foreground/10 pt-6">
      <h2 className="mb-1 text-sm font-semibold">Deck Settings</h2>
      <p className="mb-4 text-sm text-foreground/50">
        Pick up to two languages. The speaker button on cards will let you
        choose between them.
      </p>

      {!supported ? (
        <p className="text-sm text-foreground/40">
          Speech synthesis isn&apos;t available in this environment.
        </p>
      ) : (
        <div className="space-y-3">
          <LanguageRow
            label="Primary"
            slot="primary"
            value={languages.primary ?? ""}
            options={options}
            onChange={handleChange}
            onTest={handleTest}
          />
          <LanguageRow
            label="Secondary"
            slot="secondary"
            value={languages.secondary ?? ""}
            options={options}
            onChange={handleChange}
            onTest={handleTest}
          />
          {options.length === 0 && (
            <p className="text-xs text-foreground/40">
              No voices installed yet.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

interface LanguageRowProps {
  label: string;
  slot: "primary" | "secondary";
  value: string;
  options: LanguageOption[];
  onChange: (slot: "primary" | "secondary", value: string) => void;
  onTest: (slot: "primary" | "secondary") => void;
}

function LanguageRow({
  label,
  slot,
  value,
  options,
  onChange,
  onTest,
}: LanguageRowProps) {
  const id = `deck-language-${slot}`;
  return (
    <div className="flex items-center gap-3">
      <label className="w-20 text-sm text-foreground/70" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(slot, e.target.value)}
        className="rounded-lg border border-foreground/15 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-foreground/40"
      >
        <option value="">Off</option>
        {options.map((o) => (
          <option key={o.lang} value={o.lang}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onTest(slot)}
        disabled={!value}
        title="Play a sample"
        aria-label="Play a sample"
        className="flex h-8 w-8 items-center justify-center rounded-md text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-foreground/50"
      >
        <SpeakerHigh size={16} weight="regular" />
      </button>
    </div>
  );
}
