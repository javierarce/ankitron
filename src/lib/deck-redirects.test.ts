import { describe, it, expect } from "vitest";
import { recordDeckRedirect, resolveDeckRedirect } from "./deck-redirects";

// The redirect map is module-level state with no reset hook, so each test uses
// its own distinct deck names to stay independent.
describe("deck redirects", () => {
  it("returns undefined for a name that was never renamed", () => {
    expect(resolveDeckRedirect("Untouched")).toBeUndefined();
  });

  it("resolves a single rename to its new name", () => {
    recordDeckRedirect("Spanish", "Español");
    expect(resolveDeckRedirect("Spanish")).toBe("Español");
  });

  it("follows a chain of renames to the final name", () => {
    recordDeckRedirect("Chain1", "Chain2");
    recordDeckRedirect("Chain2", "Chain3");
    expect(resolveDeckRedirect("Chain1")).toBe("Chain3");
    expect(resolveDeckRedirect("Chain2")).toBe("Chain3");
  });

  it("ignores a no-op rename onto itself", () => {
    recordDeckRedirect("Same", "Same");
    expect(resolveDeckRedirect("Same")).toBeUndefined();
  });

  it("terminates on a cycle instead of looping forever", () => {
    recordDeckRedirect("Loop1", "Loop2");
    recordDeckRedirect("Loop2", "Loop1");
    // Either endpoint of the cycle is acceptable; the point is it returns.
    expect(["Loop1", "Loop2"]).toContain(resolveDeckRedirect("Loop1"));
  });
});
