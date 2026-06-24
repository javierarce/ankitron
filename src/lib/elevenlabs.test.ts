import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  ELEVENLABS_MODELS,
  getCachedVoices,
  getLastVoiceId,
  getModelId,
  setLastVoiceId,
  setModelId,
  ttsFilename,
} from "./elevenlabs";

// Lib tests run in the node environment, which has no localStorage; provide a
// plain in-memory stand-in (same shape the component tests use).
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("ttsFilename", () => {
  it("is stable for the same text, voice and model (so regenerating dedups)", () => {
    const a = ttsFilename("hello world", "voice-1", "model-1");
    const b = ttsFilename("hello world", "voice-1", "model-1");
    expect(a).toBe(b);
  });

  it("changes when any input changes", () => {
    const base = ttsFilename("hello", "voice-1", "model-1");
    expect(ttsFilename("hello!", "voice-1", "model-1")).not.toBe(base);
    expect(ttsFilename("hello", "voice-2", "model-1")).not.toBe(base);
    expect(ttsFilename("hello", "voice-1", "model-2")).not.toBe(base);
  });

  it("produces a safe .mp3 filename with no [sound:] breaking characters", () => {
    const name = ttsFilename("a [tricky] / name", "v", "m");
    expect(name).toMatch(/^tts-[a-z0-9]+\.mp3$/);
  });
});

describe("model preference", () => {
  it("defaults to the first model when unset", () => {
    expect(getModelId()).toBe(DEFAULT_MODEL_ID);
    expect(DEFAULT_MODEL_ID).toBe(ELEVENLABS_MODELS[0].id);
  });

  it("round-trips a valid model and ignores an unknown one", () => {
    setModelId(ELEVENLABS_MODELS[1].id);
    expect(getModelId()).toBe(ELEVENLABS_MODELS[1].id);

    localStorage.setItem("elevenlabs-model", "not-a-model");
    expect(getModelId()).toBe(DEFAULT_MODEL_ID);
  });
});

describe("last-used voice", () => {
  it("returns null when unset and round-trips otherwise", () => {
    expect(getLastVoiceId()).toBeNull();
    setLastVoiceId("voice-42");
    expect(getLastVoiceId()).toBe("voice-42");
  });
});

describe("cached voices", () => {
  it("returns [] when empty or corrupt", () => {
    expect(getCachedVoices()).toEqual([]);
    localStorage.setItem("elevenlabs-voices", "{not json");
    expect(getCachedVoices()).toEqual([]);
  });
});
