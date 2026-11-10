import type { StatsEvent } from "../../shared/stats";
import { endOfDay, phaseTotals, startOfDay } from "../dashboard/rollup";

/**
 * Focus + stopwatch time logged today. Events with end_ms = null (the interval
 * running right now) are counted up to `now` by phaseTotals, so the live
 * interval is included without a separate add that would double-count it.
 */
export function totalTodayMs(events: StatsEvent[], now: number): number {
  const pt = phaseTotals(events, startOfDay(now), endOfDay(now), now);
  return pt.work + pt.other;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function hms(totalSec: number, alwaysHours: boolean): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 || alwaysHours ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

/** "this run MM:SS · total today H:MM:SS" (run gains an hour part past 59:59). */
export function formatElapsedSummary(runSec: number, totalMs: number): string {
  return `this run ${hms(runSec, false)} · total today ${hms(totalMs / 1000, true)}`;
}
