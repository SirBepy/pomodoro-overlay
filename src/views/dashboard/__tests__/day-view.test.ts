import { describe, it, expect } from "vitest";
import { daySegments, breakdownRows, sessionRows } from "../day-view";
import { startOfDay } from "../rollup";
import { PHASE_COLORS } from "../phase-colors";
import type { StatsEvent } from "../../../shared/stats";
import type { DayTotals } from "../rollup";

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const ev = (start_ms: number, end_ms: number | null, phase: StatsEvent["phase"] = "work"): StatsEvent => ({
  session_id: `s-${start_ms}`, phase, start_ms, end_ms, configured_seconds: 1500, ended_by: "natural",
});

describe("daySegments", () => {
  it("maps an event to left%/width% across a fixed 24h day", () => {
    const day = startOfDay(1_700_000_000_000);
    const segs = daySegments([ev(day + 6 * HOUR, day + 12 * HOUR, "work")], day, day + 24 * HOUR);
    expect(segs).toHaveLength(1);
    expect(segs[0].leftPct).toBeCloseTo(25, 5);   // 6/24
    expect(segs[0].widthPct).toBeCloseTo(25, 5);   // 6/24
    expect(segs[0].color).toBe(PHASE_COLORS.work);
  });

  it("clips open events to now and out-of-day edges to the day bounds", () => {
    const day = startOfDay(1_700_000_000_000);
    const segs = daySegments([ev(day - 2 * HOUR, null, "work")], day, day + 3 * HOUR);
    expect(segs[0].leftPct).toBeCloseTo(0, 5);     // clipped to dayStart
    expect(segs[0].widthPct).toBeCloseTo(12.5, 5); // 3h of 24h
  });

  it("drops zero/negative-length segments", () => {
    const day = startOfDay(1_700_000_000_000);
    expect(daySegments([ev(day + HOUR, day + HOUR, "work")], day, day + 24 * HOUR)).toHaveLength(0);
  });
});

describe("breakdownRows", () => {
  const totals: DayTotals = {
    work_ms: 90 * MIN, short_ms: 20 * MIN, long_ms: 10 * MIN,
    other_ms: 0, snooze_ms: 0, idle_ms: 60 * MIN, work_sessions_completed: 3,
  };
  it("combines short+long into breaks and drops zero buckets", () => {
    const rows = breakdownRows(totals);
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(["work", "breaks", "idle"]); // other=0 dropped
    const breaks = rows.find((r) => r.key === "breaks")!;
    expect(breaks.ms).toBe(30 * MIN);
    expect(breaks.color).toBe(PHASE_COLORS.short);
  });
  it("computes pct as share of summed buckets", () => {
    const rows = breakdownRows(totals); // sum = 90+30+60 = 180
    expect(rows.find((r) => r.key === "work")!.pct).toBeCloseTo(50, 5);
  });
  it("returns empty array when everything is zero", () => {
    expect(breakdownRows({ work_ms: 0, short_ms: 0, long_ms: 0, other_ms: 0, snooze_ms: 0, idle_ms: 0, work_sessions_completed: 0 })).toEqual([]);
  });
});

describe("sessionRows", () => {
  const day = startOfDay(1_700_000_000_000);
  it("returns oldest-first rows with clipped durations and colors", () => {
    const rows = sessionRows([
      ev(day + 10 * HOUR, day + 10 * HOUR + 25 * MIN, "work"),
      ev(day + 9 * HOUR, day + 9 * HOUR + 5 * MIN, "short"),
    ], day, day + 24 * HOUR);
    expect(rows.map((r) => r.startMs)).toEqual([day + 9 * HOUR, day + 10 * HOUR]);
    expect(rows[0].durationMs).toBe(5 * MIN);
    expect(rows[1].color).toBe(PHASE_COLORS.work);
  });
  it("clips an open event to now", () => {
    const rows = sessionRows([ev(day + 9 * HOUR, null, "work")], day, day + 9 * HOUR + 10 * MIN);
    expect(rows[0].durationMs).toBe(10 * MIN);
  });
  it("excludes zero-length events", () => {
    expect(sessionRows([ev(day + 9 * HOUR, day + 9 * HOUR, "work")], day, day + 24 * HOUR)).toHaveLength(0);
  });
});
