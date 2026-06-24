// Opt-in gate for in-development features (currently ElevenLabs TTS). A plain
// localStorage flag: read both by Settings (to reveal the section) and by the
// editor (to show the TTS button), so toggling it off hides the feature
// everywhere without removing a configured key.
const EXPERIMENTAL_KEY = "experimental-features";

export function isExperimentalEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(EXPERIMENTAL_KEY) === "1";
}

export function setExperimentalEnabled(on: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (on) localStorage.setItem(EXPERIMENTAL_KEY, "1");
  else localStorage.removeItem(EXPERIMENTAL_KEY);
}
