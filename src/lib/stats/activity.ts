// Study activity over time: per-day totals, streaks, and lifetime figures.
//
// Everything here is a pure fold over RevlogEntry[] (see ./revlog), so the
// Stats page's heatmap, bar chart and hero tiles all come from one fetch and
// can be tested against hand-built fixtures without a live Anki.
//
// Days are local calendar days. Anki instead uses a configurable rollover hour
// (4am by default) that AnkiConnect doesn't expose, so a user studying at 1am
// has those reviews on the previous Anki day but the next day here. That
// mismatch is unfixable from this side and is stated in the UI rather than
// papered over.

import { isGraded, type RevlogEntry } from "./revlog";

/** Local midnight for a timestamp — the day-bucket key. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Shift a timestamp by whole calendar days, landing on local midnight.
 *
 * Calendar arithmetic, NOT ± n * 86_400_000. A local day is 23 or 25 hours long
 * across a DST boundary: on Europe/Berlin's October fall-back day, midnight plus
 * 24h lands at 23:00 of the *same* day, so normalising that back to local
 * midnight returns the day you started on — which turns every day-walking loop
 * in this file into an infinite one. setDate() moves the calendar date itself
 * and is immune, including across month and year ends.
 */
export function addDays(ms: number, delta: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + delta);
  return d.getTime();
}

/** The local midnight before `dayMs`. */
export function previousDay(dayMs: number): number {
  return addDays(dayMs, -1);
}

/** The local midnight after `dayMs`. */
export function nextDay(dayMs: number): number {
  return addDays(dayMs, 1);
}

/** One local calendar day of graded answers, across whatever decks are in scope. */
export interface DayActivity {
  /** Local midnight, epoch-ms. */
  dayMs: number;
  /** Graded answers (ease 1–4) that day. */
  reviews: number;
  /** Of those, graded better than Again. */
  passes: number;
  /** Total answering time that day, in seconds. */
  seconds: number;
}

export interface StreakInfo {
  /** Consecutive studied days ending today or yesterday — see computeStreaks. */
  current: number;
  longest: number;
  /** Local midnight of the most recent studied day, or null. */
  lastStudiedDay: number | null;
  /** Distinct days with at least one graded answer. */
  activeDays: number;
}

export interface LifetimeTotals {
  reviews: number;
  seconds: number;
  /** Epoch-ms of the earliest graded answer in scope, or null. */
  firstReviewAt: number | null;
  /** Distinct cards that have ever been graded. */
  cardsSeen: number;
}

/**
 * Fold entries into per-day totals, oldest first. Sparse: only days with
 * activity get a bucket, so a year of history costs one entry per studied day
 * rather than 365. Call densifyDays when a chart needs the gaps filled.
 *
 * Assumes `entries` are already deduped by review id — fetchCollectionRevlog
 * owns that, and repeating a Set over 200k rows per chart would be waste.
 */
export function computeDailyActivity(entries: RevlogEntry[]): DayActivity[] {
  const byDay = new Map<number, DayActivity>();

  for (const e of entries) {
    if (!isGraded(e)) continue;
    const dayMs = startOfLocalDay(e.id);
    let day = byDay.get(dayMs);
    if (!day) {
      day = { dayMs, reviews: 0, passes: 0, seconds: 0 };
      byDay.set(dayMs, day);
    }
    day.reviews++;
    if (e.ease > 1) day.passes++;
    day.seconds += e.timeMs / 1000;
  }

  return [...byDay.values()].sort((a, b) => a.dayMs - b.dayMs);
}

/**
 * Streak and coverage figures. A day counts if it holds at least one graded
 * answer.
 *
 * `current` anchors on today, but falls back to yesterday when today is still
 * empty: a streak shouldn't appear broken at 00:01 simply because the user
 * hasn't studied yet. It only ends once a full calendar day has passed with
 * nothing in it.
 *
 * `days` is expected in ascending order — computeDailyActivity's output.
 */
export function computeStreaks(
  days: DayActivity[],
  nowMs: number,
): StreakInfo {
  if (days.length === 0) {
    return { current: 0, longest: 0, lastStudiedDay: null, activeDays: 0 };
  }

  const studied = new Set(days.map((d) => d.dayMs));

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i].dayMs === nextDay(days[i - 1].dayMs) ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const today = startOfLocalDay(nowMs);
  const yesterday = previousDay(today);
  let anchor: number | null = null;
  if (studied.has(today)) anchor = today;
  else if (studied.has(yesterday)) anchor = yesterday;

  let current = 0;
  for (let day = anchor; day !== null && studied.has(day); day = previousDay(day)) {
    current++;
  }

  return {
    current,
    longest,
    lastStudiedDay: days[days.length - 1].dayMs,
    activeDays: days.length,
  };
}

/**
 * All-time totals for the hero tiles. Uses a loop rather than Math.min(...ids):
 * spreading a few hundred thousand arguments overflows the call stack, and a
 * long-time user's history is exactly that size.
 */
export function computeLifetimeTotals(entries: RevlogEntry[]): LifetimeTotals {
  let reviews = 0;
  let ms = 0;
  let firstReviewAt: number | null = null;
  const cards = new Set<number>();

  for (const e of entries) {
    if (!isGraded(e)) continue;
    reviews++;
    ms += e.timeMs;
    cards.add(e.cardId);
    if (firstReviewAt === null || e.id < firstReviewAt) firstReviewAt = e.id;
  }

  return { reviews, seconds: ms / 1000, firstReviewAt, cardsSeen: cards.size };
}

/**
 * Fill in zero-days across [fromMs, toMs] inclusive, so a chart can render a
 * gap as a gap rather than closing over it. Both bounds are normalised to local
 * midnight.
 *
 * The Stats page calls this twice over the same DayActivity[] — a rolling 12
 * months for the heatmap, a rolling 30 days for the bar chart. Both windows
 * roll rather than aligning to a calendar month or year: a calendar window is
 * nearly empty on its first day and splits a streak in two at the boundary.
 */
export function densifyDays(
  days: DayActivity[],
  fromMs: number,
  toMs: number,
): DayActivity[] {
  const byDay = new Map(days.map((d) => [d.dayMs, d]));
  const last = startOfLocalDay(toMs);
  const out: DayActivity[] = [];

  for (let day = startOfLocalDay(fromMs); day <= last; day = nextDay(day)) {
    out.push(byDay.get(day) ?? { dayMs: day, reviews: 0, passes: 0, seconds: 0 });
  }

  return out;
}
