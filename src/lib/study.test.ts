import { describe, it, expect } from "vitest";
import { canUndo } from "./study";

describe("canUndo", () => {
  it("allows undo mid-session after a review", () => {
    expect(canUndo({ completed: false, reviewed: 1 })).toBe(true);
  });

  it("blocks undo once the session is complete", () => {
    expect(canUndo({ completed: true, reviewed: 3 })).toBe(false);
  });

  it("blocks undo before anything has been reviewed", () => {
    expect(canUndo({ completed: false, reviewed: 0 })).toBe(false);
  });
});
