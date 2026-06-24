import { useState } from "react";
import {
  ELEVENLABS_MODELS,
  ElevenLabsError,
  getModelId,
  isConfigured,
  listVoices,
  setApiKey,
  setModelId,
} from "@/lib/elevenlabs";

const PERMISSIONS_HINT = "Add the text_to_speech and voices_read permissions.";

export function ElevenLabsSettings() {
  // Show the input when no key is set; the masked view (with Replace) otherwise.
  // Read from the non-secret localStorage flag — a synchronous check, no Rust
  // round-trip when Settings opens.
  const [editing, setEditing] = useState(() => !isConfigured());
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Errors only — a successful save just returns to the masked view.
  const [error, setError] = useState<string | null>(null);

  const [model, setModel] = useState(getModelId);

  // Save the key, then load voices — fetching is how we validate it, so the
  // user finds out here if it's wrong or missing permissions.
  async function handleSave() {
    if (busy || keyInput.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await setApiKey(keyInput);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    try {
      // Loading voices validates the key; only switch to the masked view once
      // it succeeds, so a rejected key stays in the field with the reason shown.
      await listVoices();
    } catch (e) {
      // Only discard the key for a genuine auth/permission failure (the key is
      // bad). On transient errors — offline, rate limit, server hiccup — keep
      // it so a valid key isn't lost to a temporary blip; the user can retry.
      if (e instanceof ElevenLabsError && e.kind === "auth") {
        await setApiKey("").catch(() => {});
      }
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    setKeyInput("");
    setEditing(false);
    setBusy(false);
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    try {
      await setApiKey("");
      setKeyInput("");
      setEditing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleModelChange(id: string) {
    setModel(id);
    setModelId(id);
  }

  return (
    <div className="py-4">
      <p className="text-sm font-medium">ElevenLabs text-to-speech</p>
      <p className="mt-1 text-xs text-foreground/50">
        Generate audio for selected text while editing a note.
      </p>

      <div className="mt-3 flex gap-2">
        {editing ? (
          <>
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
              placeholder="ElevenLabs API key"
              autoComplete="off"
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-foreground/15 bg-transparent px-3 py-1.5 text-sm placeholder:text-foreground/40 focus:border-foreground/40 focus:outline-none"
            />
            <button
              onClick={handleSave}
              disabled={busy || keyInput.trim().length === 0}
              className="shrink-0 rounded-md border border-foreground/15 px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <>
            {/* A disabled password input renders the real native masking
                circles (matching the editing field) over a placeholder value;
                the darker fill marks it read-only. We never hold the real key. */}
            <input
              type="password"
              value={"0".repeat(48)}
              readOnly
              disabled
              aria-label="API key saved"
              className="min-w-0 flex-1 cursor-default rounded-md border border-foreground/15 bg-foreground/[0.06] px-3 py-1.5 text-sm text-foreground/40 disabled:opacity-100"
            />
            {/* Replace clears the stored key and reveals the field — to swap a
                key you re-enter it, so there's no separate Remove. */}
            <button
              onClick={handleRemove}
              disabled={busy}
              className="shrink-0 rounded-md border border-foreground/15 px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:opacity-50"
            >
              Replace
            </button>
          </>
        )}
      </div>

      {editing && (
        <p className="mt-1.5 text-xs text-foreground/50">{PERMISSIONS_HINT}</p>
      )}

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {/* The model only matters once a key is set (editing === no stored key). */}
      {!editing && (
        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Model</p>
            <p className="text-xs text-foreground/50">
              Quality vs. speed and cost.
            </p>
          </div>
          <select
            value={model}
            onChange={(e) => handleModelChange(e.target.value)}
            aria-label="ElevenLabs model"
            className="rounded-md border border-foreground/15 bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
          >
            {ELEVENLABS_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
