import type { StatsEvent, Phase } from "../../shared/stats";
import type { DayTotals } from "./rollup";
import { endOfDay } from "./rollup";
import { PHASE_COLORS } from "./phase-colors";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Segments/rows of one minute or less are noise (timer blinks, app-kill grace
 *  remnants) and are dropped from the dashboard. */
const MIN_EVENT_MS = 60_000;

export interface BarSegment {
  leftPct: number;
  widthPct: number;
  color: string;
  phase: Phase;
  startMs: number;
  endMs: number;
}

/** Map each event to a proportional segment across the fixed 24h of `dayStart`.
 *  Open events (end_ms == null) clip to min(now, endOfDay). Min visual width is a CSS concern. */
export function daySegments(events: StatsEvent[], dayStart: number, now: number): BarSegment[] {
  const dayEnd = endOfDay(dayStart);
  const out: BarSegment[] = [];
  for (const e of events) {
    const start = Math.max(e.start_ms, dayStart);
    const end = Math.min(e.end_ms ?? now, dayEnd, now); // clip to day end and (for open events) to now
    if (end - start <= MIN_EVENT_MS) continue; // drop zero/negative + sub-minute noise
    out.push({
      leftPct: ((start - dayStart) / DAY_MS) * 100,
      widthPct: ((end - start) / DAY_MS) * 100,
      color: (PHASE_COLORS as Record<string, string>)[e.phase] ?? "#888",
      phase: e.phase,
      startMs: start,
      endMs: end,
    });
  }
  return out;
}

export interface BreakdownRow {
  key: "work" | "short" | "long" | "other" | "idle";
  label: string;
  ms: number;
  color: string;
  pct: number;
}

/** One row per phase (work / short break / long break / other) plus idle, each
 *  in its real phase color. Drops zero buckets; pct = share of summed buckets. */
export function breakdownRows(totals: DayTotals): BreakdownRow[] {
  const raw: Array<Omit<BreakdownRow, "pct">> = [
    { key: "work", label: "Work", ms: totals.work_ms, color: PHASE_COLORS.work },
    { key: "short", label: "Short break", ms: totals.short_ms, color: PHASE_COLORS.short },
    { key: "long", label: "Long break", ms: totals.long_ms, color: PHASE_COLORS.long },
    { key: "other", label: "Other", ms: totals.other_ms, color: PHASE_COLORS.other },
    { key: "idle", label: "Idle", ms: totals.idle_ms, color: PHASE_COLORS.idle },
  ];
  const nonZero = raw.filter((r) => r.ms > 0);
  const sum = nonZero.reduce((acc, r) => acc + r.ms, 0);
  if (sum === 0) return [];
  return nonZero.map((r) => ({ ...r, pct: (r.ms / sum) * 100 }));
}

export interface SessionRow {
  startMs: number;
  phase: Phase;
  durationMs: number;
  color: string;
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
      return { phase: e.phase, start, durationMs: end - start };
    })
    .filter((e) => e.durationMs > MIN_EVENT_MS)
    .sort((a, b) => a.start - b.start);

  // Merge runs of the same phase (now adjacent) into a single row.
  const merged: SessionRow[] = [];
  for (const e of clipped) {
    const last = merged[merged.length - 1];
    if (last && last.phase === e.phase) {
      last.durationMs += e.durationMs;
    } else {
      merged.push({
        startMs: e.start,
        phase: e.phase,
        durationMs: e.durationMs,
        color: (PHASE_COLORS as Record<string, string>)[e.phase] ?? "#888",
      });
    }
  }

  return merged;
}
