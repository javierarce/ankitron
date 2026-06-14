const PRIMARY_KEY = (deckName: string) => `deck-language:${deckName}`;
const SECONDARY_KEY = (deckName: string) => `deck-language-2:${deckName}`;

export interface DeckLanguages {
  primary: string | null;
  secondary: string | null;
}

export function getDeckLanguages(deckName: string): DeckLanguages {
  if (typeof window === "undefined") return { primary: null, secondary: null };
  return {
    primary: localStorage.getItem(PRIMARY_KEY(deckName)),
    secondary: localStorage.getItem(SECONDARY_KEY(deckName)),
  };
}

export function setDeckLanguage(
  deckName: string,
  slot: "primary" | "secondary",
  lang: string | null
): void {
  if (typeof window === "undefined") return;
  const key = slot === "primary" ? PRIMARY_KEY(deckName) : SECONDARY_KEY(deckName);
  if (!lang) localStorage.removeItem(key);
  else localStorage.setItem(key, lang);
}

/**
 * Move each deck's stored language settings to its new name after a rename.
 * Takes the from → to pairs produced by `renameDeck` so subdecks are carried
 * along with their parent.
 */
export function migrateDeckLanguages(
  renames: { from: string; to: string }[],
): void {
  if (typeof window === "undefined") return;
  for (const { from, to } of renames) {
    for (const makeKey of [PRIMARY_KEY, SECONDARY_KEY]) {
      const value = localStorage.getItem(makeKey(from));
      if (value === null) continue;
      localStorage.setItem(makeKey(to), value);
      localStorage.removeItem(makeKey(from));
    }
  }
}

export function stripHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("style, script").forEach((el) => el.remove());
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function speak(
  text: string,
  lang: string,
  opts?: { onEnd?: () => void }
): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.lang = lang;
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0];
  const match =
    voices.find((v) => v.lang === lang) ??
    voices.find((v) => v.lang.replace("_", "-") === lang) ??
    voices.find((v) => v.lang.split(/[-_]/)[0] === base);
  if (match) utterance.voice = match;
  if (opts?.onEnd) {
    utterance.onend = opts.onEnd;
    utterance.onerror = opts.onEnd;
  }
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}
