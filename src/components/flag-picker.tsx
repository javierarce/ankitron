// The flag colour grid shown inside a card's actions menu. Anki uses a
// submenu; we inline the seven colours as a grid of circles plus a "no flag"
// slot, since only one flag can be set at a time. The current flag reads back
// as a halo around its circle. Tapping the active colour again clears it, the
// way Anki's Ctrl+<n> toggles a flag off.

import { FLAGS } from "@/lib/flags";

export function FlagPicker({
  value,
  onSelect,
}: {
  /** The current flag number (0 = none). */
  value: number;
  /** Apply a flag, or 0 to clear it. */
  onSelect: (flag: number) => void;
}) {
  return (
    // A top divider sets the grid apart from the plain menu items above it.
    <div className="mt-1 border-t border-border px-3 pb-1.5 pt-2">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-foreground/30">
        Flag
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {FLAGS.map((f) => {
          const selected = value === f.value;
          return (
            <button
              key={f.value}
              type="button"
              aria-label={`${f.name} flag`}
              aria-pressed={selected}
              title={f.name}
              // Re-tapping the current colour clears the flag (Anki's toggle).
              onClick={() => onSelect(selected ? 0 : f.value)}
              className="flex h-7 items-center justify-center rounded-md transition-colors hover:bg-foreground/5"
            >
              <span
                className="h-4 w-4 rounded-full"
                style={{
                  background: f.color,
                  // A background-gap halo in the flag's own colour marks the
                  // selection — legible on any circle colour, unlike an inset check.
                  boxShadow: selected
                    ? `0 0 0 2px var(--background), 0 0 0 3.5px ${f.color}`
                    : undefined,
                }}
              />
            </button>
          );
        })}
        <button
          type="button"
          aria-label="No flag"
          aria-pressed={value === 0}
          title="No flag"
          onClick={() => onSelect(0)}
          className="flex h-7 items-center justify-center rounded-md transition-colors hover:bg-foreground/5"
        >
          {/* An empty bordered circle, selected the same way as the colours:
             a background-gap halo (in a neutral tone) rather than a checkmark. */}
          <span
            className={`h-4 w-4 rounded-full border ${
              value === 0 ? "border-foreground/50" : "border-foreground/25"
            }`}
            style={{
              boxShadow:
                value === 0
                  ? "0 0 0 2px var(--background), 0 0 0 3.5px color-mix(in srgb, var(--foreground) 45%, transparent)"
                  : undefined,
            }}
          />
        </button>
      </div>
    </div>
  );
}
