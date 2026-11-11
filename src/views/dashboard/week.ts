import type { StatsEvent } from "../../shared/stats";
import { addDays, phaseTotals } from "./rollup";

export const WEEK_DAYS = 7;
const HOUR_MS = 60 * 60 * 1000;

export interface WeekWindow {
  /** Local midnight of the first column. */
  startDay: number;
  /** Local midnight of the last column. */
  endDay: number;
}

/** Rolling 7-day window. It ends on `today` unless the user paged back
 *  (`pagedEnd`); a selected day outside it slides the window by just enough to
 *  bring that day to the nearest edge, so stepping day by day moves it day by day. */
export function weekWindow(selectedDay: number, today: number, pagedEnd: number | null): WeekWindow {
  let endDay = Math.min(pagedEnd ?? today, today);
  if (selectedDay > endDay) endDay = Math.min(selectedDay, today);
  else if (selectedDay < addDays(endDay, -(WEEK_DAYS - 1))) endDay = addDays(selectedDay, WEEK_DAYS - 1);
  endDay = Math.min(endDay, today);
  return { startDay: addDays(endDay, -(WEEK_DAYS - 1)), endDay };
}

export interface WeekDay {
  dayStart: number;
  workMs: number;
}

/** Focus (work) time per day for the 7 days from `windowStart`. Not noise-filtered:
 *  these are totals, and the minute filter is a display rule for single events. */
export function weekFocus(events: StatsEvent[], windowStart: number, now: number): WeekDay[] {
  const days: WeekDay[] = [];
  for (let i = 0; i < WEEK_DAYS; i++) {
    const dayStart = addDays(windowStart, i);
    const workMs = phaseTotals(events, dayStart, addDays(dayStart, 1), now).work;
    days.push({ dayStart, workMs });
  }
  return days;
}

/** Y-axis maximum: at least 6h, otherwise the busiest day rounded up to 2h. */
export function weekScale(maxDayMs: number): number {
  return Math.max(6 * HOUR_MS, Math.ceil(maxDayMs / (2 * HOUR_MS)) * 2 * HOUR_MS);
}

/** Gridline heights in ms. Every 2h while that stays readable in the 104px
 *  plot, every 4h once the scale passes 8h. */
export function weekGridlines(scaleMs: number): number[] {
  const step = scaleMs > 8 * HOUR_MS ? 4 * HOUR_MS : 2 * HOUR_MS;
  const out: number[] = [];
  for (let v = step; v <= scaleMs; v += step) out.push(v);
  return out;
}

export interface WeekSummary {
  totalMs: number;
  avgMs: number;
}

/** Average is over all 7 days, including zero days and today's partial one. */
export function weekSummary(days: WeekDay[]): WeekSummary {
  const totalMs = days.reduce((a, d) => a + d.workMs, 0);
  return { totalMs, avgMs: totalMs / WEEK_DAYS };
}
