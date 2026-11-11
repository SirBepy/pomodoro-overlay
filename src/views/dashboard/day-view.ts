import type { StatsEvent, Phase } from "../../shared/stats";
import { endOfDay, startOfDay } from "./rollup";
import { PHASE_COLORS } from "./phase-colors";

/** Segments/rows of one minute or less are noise (timer blinks, app-kill grace
 *  remnants) and are dropped from the dashboard. */
export const MIN_EVENT_MS = 60_000;

const HOUR_MS = 60 * 60 * 1000;

export interface SessionRow {
  startMs: number;
  endMs: number;
  phase: Phase;
  durationMs: number;
  color: string;
  /** The row still ticks: it contains an open event on the current day. */
  running: boolean;
}

/** Oldest-first rows for the session list. Consecutive same-phase events are
 *  merged into one row (first start, summed duration) to cut duplicate clutter;
 *  merged groups of one minute or less are dropped. Idle is gap time (not an
 *  event), so it does not appear here. */
export function sessionRows(events: StatsEvent[], dayStart: number, now: number): SessionRow[] {
  const dayEnd = endOfDay(dayStart);

  // Clip to the day, DROP sub-minute noise first (so a tiny blip between two
  // same-phase blocks doesn't split them), then sort chronologically.
  const clipped = events
    .map((e) => {
      const start = Math.max(e.start_ms, dayStart);
      const end = Math.min(e.end_ms ?? now, dayEnd);
      // An open event on a past day was cut off at midnight: it is not running there.
      const open = e.end_ms == null && now < dayEnd;
      return { phase: e.phase, start, durationMs: end - start, open };
    })
    .filter((e) => e.durationMs > MIN_EVENT_MS)
    .sort((a, b) => a.start - b.start);

  // Merge runs of the same phase (now adjacent) into a single row.
  const merged: SessionRow[] = [];
  for (const e of clipped) {
    const last = merged[merged.length - 1];
    if (last && last.phase === e.phase) {
      last.durationMs += e.durationMs;
      last.endMs = last.startMs + last.durationMs;
      last.running = last.running || e.open;
    } else {
      merged.push({
        startMs: e.start,
        endMs: e.start + e.durationMs,
        phase: e.phase,
        durationMs: e.durationMs,
        color: (PHASE_COLORS as Record<string, string>)[e.phase] ?? "#888",
        running: e.open,
      });
    }
  }

  return merged;
}

export interface StripMark {
  phase: Phase;
  startMs: number;
  endMs: number;
  leftPct: number;
  widthPct: number;
  /** Work and stopwatch are drawn full height, breaks and snooze shorter, so the
   *  work/break split survives where the two break colors are hard to tell apart. */
  tall: boolean;
}

export interface StripIdleGap {
  startMs: number;
  endMs: number;
  leftPct: number;
  widthPct: number;
}

export interface StripModel {
  startMs: number;
  endMs: number;
  /** Window bounds as minutes since `dayStart`. */
  startMin: number;
  endMin: number;
  marks: StripMark[];
  idleGaps: StripIdleGap[];
  /** Hour-aligned axis ticks, first and last included. */
  ticks: Array<{ ms: number; pct: number }>;
  /** Position of "now" in the window, only on the current day. */
  nowPct: number | null;
}

function floorToHour(ms: number): number {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function ceilToHour(ms: number): number {
  const f = floorToHour(ms);
  return f === ms ? ms : f + HOUR_MS;
}

/** Layout of the zoomed day strip: the window runs from the hour floor of the
 *  first event to the hour ceil of the last event end (or `now` on today), so a
 *  short day fills the strip instead of hiding in a 24h bar. Returns null when
 *  nothing survives the one-minute noise filter. */
export function stripModel(
  events: StatsEvent[],
  dayStart: number,
  now: number,
  capMinutes: number,
): StripModel | null {
  const dayEnd = endOfDay(dayStart);
  const isToday = dayStart === startOfDay(now);
  const capMs = capMinutes * 60_000;

  const kept = events
    .map((e) => ({
      phase: e.phase,
      startMs: Math.max(e.start_ms, dayStart),
      endMs: Math.min(e.end_ms ?? now, dayEnd),
    }))
    .filter((e) => e.endMs - e.startMs > MIN_EVENT_MS)
    .sort((a, b) => a.startMs - b.startMs);
  if (kept.length === 0) return null;

  const lastEnd = Math.max(...kept.map((e) => e.endMs));
  const startMs = floorToHour(kept[0].startMs);
  const endMs = ceilToHour(isToday ? Math.max(lastEnd, now) : lastEnd);
  const span = endMs - startMs;
  const pct = (ms: number) => ((ms - startMs) / span) * 100;

  const marks: StripMark[] = kept.map((e) => ({
    ...e,
    leftPct: pct(e.startMs),
    widthPct: ((e.endMs - e.startMs) / span) * 100,
    tall: e.phase === "work" || e.phase === "other",
  }));

  // Same rule as rollup.idleMs: a gap counts as idle only up to the cap, so a
  // long absence stays blank instead of reading as a lazy stretch.
  const idleGaps: StripIdleGap[] = [];
  let cursor = kept[0].endMs;
  for (const e of kept) {
    if (e.startMs > cursor && e.startMs - cursor <= capMs) {
      idleGaps.push({
        startMs: cursor,
        endMs: e.startMs,
        leftPct: pct(cursor),
        widthPct: ((e.startMs - cursor) / span) * 100,
      });
    }
    cursor = Math.max(cursor, e.endMs);
  }

  const ticks: StripModel["ticks"] = [];
  for (let t = startMs; t <= endMs; ) {
    ticks.push({ ms: t, pct: pct(t) });
    const d = new Date(t);
    d.setHours(d.getHours() + 1);
    t = d.getTime();
  }

  return {
    startMs,
    endMs,
    startMin: (startMs - dayStart) / 60_000,
    endMin: (endMs - dayStart) / 60_000,
    marks,
    idleGaps,
    ticks,
    nowPct: isToday ? pct(now) : null,
  };
}
