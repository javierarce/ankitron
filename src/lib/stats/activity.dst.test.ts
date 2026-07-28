// Day-walking across daylight-saving boundaries.
//
// Split into its own file because it pins the timezone: CI runs in UTC, which
// has no DST at all, so these cases would silently pass for the wrong reason
// alongside the other tests.
//
// The bug this guards against was real. previousDay/nextDay were originally
// startOfLocalDay(dayMs ± 86_400_000), which looks safe — adding a day then
// snapping to midnight. It isn't: Europe/Berlin's October fall-back day is 25
// hours long, so midnight + 24h is 23:00 of the SAME day and snapping returns
// the day you started on. densifyDays looped forever and ate 4GB of heap.

import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  addDays,
  densifyDays,
  nextDay,
  previousDay,
  startOfLocalDay,
} from "./activity";

const originalTz = process.env.TZ;

beforeAll(() => {
  // Node re-reads TZ on the next Date operation, so this takes effect here.
  process.env.TZ = "Europe/Berlin";
});

afterAll(() => {
  process.env.TZ = originalTz;
});

// 2025-10-26 is Berlin's fall-back day (25 hours); 2025-03-30 springs forward
// (23 hours).
const fallBack = () => new Date(2025, 9, 26).getTime();
const springForward = () => new Date(2025, 2, 30).getTime();

describe("day stepping across DST", () => {
  // Without this, a TZ pin that silently failed would make every case below
  // pass vacuously under CI's UTC — where no day is ever 25 hours long.
  it("really is running in a timezone with DST", () => {
    const midnight = startOfLocalDay(fallBack());

    // 24 hours after midnight is still the 26th: the day has 25 of them.
    expect(new Date(midnight + 86_400_000).getDate()).toBe(26);
  });

  it("advances off the 25-hour day instead of standing still", () => {
    const day = startOfLocalDay(fallBack());

    expect(nextDay(day)).toBeGreaterThan(day);
    expect(new Date(nextDay(day)).getDate()).toBe(27);
  });

  it("steps back onto the 25-hour day", () => {
    const dayAfter = startOfLocalDay(new Date(2025, 9, 27).getTime());

    expect(previousDay(dayAfter)).toBe(startOfLocalDay(fallBack()));
  });

  it("handles the 23-hour day in both directions", () => {
    const day = startOfLocalDay(springForward());

    expect(new Date(nextDay(day)).getDate()).toBe(31);
    expect(new Date(previousDay(day)).getDate()).toBe(29);
  });

  it("crosses month and year ends", () => {
    expect(new Date(nextDay(new Date(2025, 11, 31).getTime())).getFullYear()).toBe(
      2026,
    );
    expect(new Date(previousDay(new Date(2026, 0, 1).getTime())).getMonth()).toBe(
      11,
    );
  });

  it("lands on the right day when shifting a whole year", () => {
    // 364 steps back from 2026-06-15 crosses both transitions.
    const from = addDays(new Date(2026, 5, 15, 12).getTime(), -364);

    expect(new Date(from).getFullYear()).toBe(2025);
    expect(new Date(from).getMonth()).toBe(5);
    expect(new Date(from).getDate()).toBe(16);
  });
});

describe("densifyDays across DST", () => {
  it("emits one entry per calendar day over the fall-back month", () => {
    const from = new Date(2025, 9, 1).getTime();
    const to = new Date(2025, 10, 1).getTime();

    const result = densifyDays([], from, to);

    expect(result).toHaveLength(32); // all 31 days of October, plus Nov 1
    expect(new Set(result.map((d) => d.dayMs)).size).toBe(32); // no repeats
    for (let i = 1; i < result.length; i++) {
      expect(result[i].dayMs).toBeGreaterThan(result[i - 1].dayMs);
    }
  });

  it("emits exactly 365 days for the heatmap's rolling year", () => {
    const to = new Date(2026, 5, 15, 12).getTime();
    const from = addDays(to, -364);

    expect(densifyDays([], from, to)).toHaveLength(365);
  });
});
