"use client";

import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { ankiFetch } from "@/lib/anki-fetch";

export function SyncButton() {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      await ankiFetch("sync");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      title={error ?? "Sync with AnkiWeb"}
      className="flex items-center gap-1.5 text-sm text-foreground/50 hover:text-foreground transition-colors disabled:opacity-60"
    >
      <ArrowsClockwise
        size={13}
        weight="bold"
        className={syncing ? "animate-spin" : ""}
      />
      {syncing ? "Syncing…" : "Sync"}
    </button>
  );
}
