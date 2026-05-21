import type { StatsEvent, Phase } from "../../shared/stats";
import type { DayTotals } from "./rollup";
import { endOfDay } from "./rollup";
import { PHASE_COLORS } from "./phase-colors";

const DAY_MS = 24 * 60 * 60 * 1000;

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
    if (end <= start) continue;
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
  key: "work" | "breaks" | "idle" | "other";
  label: string;
  ms: number;
  color: string;
  pct: number;
}

/** Buckets for the breakdown block: work / breaks(short+long) / idle / other.
 *  Drops zero buckets; pct = share of summed non-zero buckets. */
export function breakdownRows(totals: DayTotals): BreakdownRow[] {
  const raw: Array<Omit<BreakdownRow, "pct">> = [
    { key: "work", label: "Work", ms: totals.work_ms, color: PHASE_COLORS.work },
    { key: "breaks", label: "Breaks", ms: totals.short_ms + totals.long_ms, color: PHASE_COLORS.short },
    { key: "idle", label: "Idle", ms: totals.idle_ms, color: PHASE_COLORS.idle },
    { key: "other", label: "Other", ms: totals.other_ms, color: PHASE_COLORS.other },
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

/** Oldest-first rows for the session list. Clips open events to now; excludes zero-length.
 *  Idle is gap time (not an event), so it does not appear here. */
export function sessionRows(events: StatsEvent[], dayStart: number, now: number): SessionRow[] {
  const dayEnd = endOfDay(dayStart);
  const rows: SessionRow[] = [];
  for (const e of events) {
    const start = Math.max(e.start_ms, dayStart);
    const end = Math.min(e.end_ms ?? now, dayEnd);
    if (end <= start) continue;
    rows.push({
      startMs: start,
      phase: e.phase,
      durationMs: end - start,
      color: (PHASE_COLORS as Record<string, string>)[e.phase] ?? "#888",
    });
  }
  rows.sort((a, b) => a.startMs - b.startMs);
  return rows;
}
