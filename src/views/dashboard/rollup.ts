import type { StatsEvent, Phase } from "../../shared/stats";

export interface DayTotals {
  work_ms: number;
  short_ms: number;
  long_ms: number;
  other_ms: number;
  snooze_ms: number;
  idle_ms: number;
  work_sessions_completed: number;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: number): number {
  return startOfDay(ts) + 24 * 60 * 60 * 1000;
}

/**
 * Sum of (end - start) per phase, clipping each event to [rangeStart, rangeEnd].
 * For events with end_ms = null, treat as ending at min(now, rangeEnd).
 */
export function phaseTotals(
  events: StatsEvent[],
  rangeStart: number,
  rangeEnd: number,
  now: number,
): Record<Phase, number> {
  const out: Record<Phase, number> = {
    work: 0, short: 0, long: 0, other: 0, snooze: 0,
  };
  for (const e of events) {
    const start = Math.max(e.start_ms, rangeStart);
    const rawEnd = e.end_ms ?? now;
    const end = Math.min(rawEnd, rangeEnd);
    if (end <= start) continue;
    out[e.phase] += end - start;
  }
  return out;
}

/**
 * Idle = wall time in [rangeStart, rangeEnd] not covered by any event,
 * EXCLUDING any gap longer than cap_minutes. Includes leading and trailing
 * gaps clipped to the range and to `now` for the trailing edge of "today".
 */
export function idleMs(
  events: StatsEvent[],
  rangeStart: number,
  rangeEnd: number,
  now: number,
  capMinutes: number,
): number {
  const capMs = capMinutes * 60 * 1000;
  const effectiveEnd = Math.min(rangeEnd, now);
  if (effectiveEnd <= rangeStart) return 0;

  const intervals: Array<[number, number]> = [];
  for (const e of events) {
    const s = Math.max(e.start_ms, rangeStart);
    const rawEnd = e.end_ms ?? now;
    const en = Math.min(rawEnd, effectiveEnd);
    if (en > s) intervals.push([s, en]);
  }
  intervals.sort((a, b) => a[0] - b[0]);

  let cursor = rangeStart;
  let idle = 0;
  for (const [s, en] of intervals) {
    if (s > cursor) {
      const gap = s - cursor;
      if (gap <= capMs) idle += gap;
    }
    cursor = Math.max(cursor, en);
  }
  if (effectiveEnd > cursor) {
    const gap = effectiveEnd - cursor;
    if (gap <= capMs) idle += gap;
  }
  return idle;
}

export function workSessionsCompleted(events: StatsEvent[]): number {
  const completed = new Set<string>();
  for (const e of events) {
    if (e.phase === "work" && e.ended_by === "natural") {
      completed.add(e.session_id);
    }
  }
  return completed.size;
}

export function todayTotals(
  events: StatsEvent[],
  now: number,
  capMinutes: number,
): DayTotals {
  const s = startOfDay(now);
  const e = endOfDay(now);
  const pt = phaseTotals(events, s, e, now);
  return {
    work_ms: pt.work,
    short_ms: pt.short,
    long_ms: pt.long,
    other_ms: pt.other,
    snooze_ms: pt.snooze,
    idle_ms: idleMs(events, s, e, now, capMinutes),
    work_sessions_completed: workSessionsCompleted(events.filter((ev) => ev.start_ms >= s)),
  };
}

export interface DayBucket {
  date_start: number;
  totals: DayTotals;
}

export function sevenDayBuckets(
  events: StatsEvent[],
  now: number,
  capMinutes: number,
): DayBucket[] {
  const buckets: DayBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = startOfDay(now - i * 24 * 60 * 60 * 1000);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const dayEvents = events.filter(
      (e) => (e.end_ms ?? now) >= dayStart && e.start_ms <= dayEnd,
    );
    const pt = phaseTotals(dayEvents, dayStart, dayEnd, now);
    buckets.push({
      date_start: dayStart,
      totals: {
        work_ms: pt.work,
        short_ms: pt.short,
        long_ms: pt.long,
        other_ms: pt.other,
        snooze_ms: pt.snooze,
        idle_ms: idleMs(dayEvents, dayStart, dayEnd, now, capMinutes),
        work_sessions_completed: workSessionsCompleted(
          dayEvents.filter((ev) => ev.start_ms >= dayStart),
        ),
      },
    });
  }
  return buckets;
}
