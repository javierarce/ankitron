import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Guard against the one way the demo can silently drift from the real app.
//
// The demo (mock-anki.ts) runs the real UI, so component/layout/style changes
// flow through for free — there's nothing to keep in sync there. The single
// coupling point is the AnkiConnect contract: the actions the app asks for via
// ankiFetch(). If a change makes the app call a new action the mock doesn't
// handle, the demo would quietly fall through to the mock's default case. This
// test turns that quiet drift into a loud CI failure naming the missing action.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", ".."); // src/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules") return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Every AnkiConnect action the running app asks for, mined from ankiFetch()
// call sites. Skips test files (not the running app) and the demo dir itself
// (the mock and fixtures are the callee, not a caller). The pattern tolerates
// the (sometimes multi-line, nested) generic on ankiFetch<…>("action", …).
function actionsUsedByApp(): Set<string> {
  const files = walk(SRC).filter(
    (f) =>
      /\.(ts|tsx)$/.test(f) &&
      !/\.test\.(ts|tsx)$/.test(f) &&
      !f.includes("/demo/"),
  );
  const re = /ankiFetch(?:\s*<[\s\S]*?>)?\s*\(\s*"([a-zA-Z]+)"/g;
  const used = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(f, "utf8").matchAll(re)) used.add(m[1]);
  }
  return used;
}

// Every action the mock handles, mined from its switch's `case "x":` labels —
// the switch stays the single source of truth, so this can't itself drift.
function actionsHandledByMock(): Set<string> {
  const src = readFileSync(join(here, "mock-anki.ts"), "utf8");
  const handled = new Set<string>();
  for (const m of src.matchAll(/case\s+"([a-zA-Z]+)":/g)) handled.add(m[1]);
  return handled;
}

describe("demo mock ⇄ app AnkiConnect contract", () => {
  it("sanity: the scanner actually finds ankiFetch call sites", () => {
    // A guard on the guard — if the regex silently matched nothing (e.g. the
    // call style changed), the real assertion below would pass vacuously.
    expect(actionsUsedByApp().size).toBeGreaterThan(10);
  });

  it("handles every AnkiConnect action the app calls", () => {
    const handled = actionsHandledByMock();
    const missing = [...actionsUsedByApp()].filter((a) => !handled.has(a)).sort();
    expect(
      missing,
      `src/lib/demo/mock-anki.ts has no case for these actions the app now calls: ` +
        `${missing.join(", ")}. Add a handler (or a deliberate stub) so the demo ` +
        `doesn't fall through to the default warning.`,
    ).toEqual([]);
  });
});
