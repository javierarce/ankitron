"use client";

import { useEffect, useState } from "react";
import { ankiFetch } from "@/lib/anki-fetch";

export function ConnectionStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    ankiFetch<number>("version")
      .then((v) => setConnected(v >= 6))
      .catch(() => setConnected(false));
  }, []);

  if (connected === null) {
    return (
      <span className="flex items-center gap-2 text-sm text-foreground/50">
        <span className="h-2 w-2 rounded-full bg-foreground/30" />
        Checking...
      </span>
    );
  }

  return (
    <span
      className={`flex items-center gap-2 text-sm ${
        connected ? "text-green-600 dark:text-green-400" : "text-red-500"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          connected ? "bg-green-500" : "bg-red-500"
        }`}
      />
      {connected ? "Connected" : "Anki not running"}
    </span>
  );
}
