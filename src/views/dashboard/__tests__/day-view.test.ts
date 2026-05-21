import { describe, it, expect } from "vitest";
import { daySegments, breakdownRows, sessionRows, pieSlices } from "../day-view";
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

  it("drops segments of one minute or less (noise filter)", () => {
    const day = startOfDay(1_700_000_000_000);
    expect(daySegments([ev(day + HOUR, day + HOUR + 30_000, "work")], day, day + 24 * HOUR)).toHaveLength(0);
    expect(daySegments([ev(day + HOUR, day + HOUR + 90_000, "work")], day, day + 24 * HOUR)).toHaveLength(1);
  });
});

describe("breakdownRows", () => {
  const totals: DayTotals = {
    work_ms: 90 * MIN, short_ms: 20 * MIN, long_ms: 10 * MIN,
    other_ms: 0, snooze_ms: 0, idle_ms: 60 * MIN, work_sessions_completed: 3,
  };
  it("emits one row per non-zero phase in real colors", () => {
    const rows = breakdownRows(totals);
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(["work", "short", "long", "idle"]); // other=0 dropped
    expect(rows.find((r) => r.key === "short")!.color).toBe(PHASE_COLORS.short);
    expect(rows.find((r) => r.key === "long")!.color).toBe(PHASE_COLORS.long);
  });
  it("computes pct as share of summed buckets", () => {
    const rows = breakdownRows(totals); // sum = 90+20+10+60 = 180
    expect(rows.find((r) => r.key === "work")!.pct).toBeCloseTo(50, 5);
  });
  it("returns empty array when everything is zero", () => {
    expect(breakdownRows({ work_ms: 0, short_ms: 0, long_ms: 0, other_ms: 0, snooze_ms: 0, idle_ms: 0, work_sessions_completed: 0 })).toEqual([]);
  });
});

describe("sessionRows", () => {
  const day = startOfDay(1_700_000_000_000);
  it("returns oldest-first rows with colors", () => {
    const rows = sessionRows([
      ev(day + 10 * HOUR, day + 10 * HOUR + 25 * MIN, "work"),
      ev(day + 9 * HOUR, day + 9 * HOUR + 5 * MIN, "short"),
    ], day, day + 24 * HOUR);
    expect(rows.map((r) => r.startMs)).toEqual([day + 9 * HOUR, day + 10 * HOUR]);
    expect(rows[0].durationMs).toBe(5 * MIN);
    expect(rows[1].color).toBe(PHASE_COLORS.work);
  });
  it("merges consecutive same-phase events into one row (summed duration, first start)", () => {
    const rows = sessionRows([
      ev(day + 9 * HOUR, day + 9 * HOUR, "work"),                       // 0m blink
      ev(day + 9 * HOUR, day + 9 * HOUR + 25 * MIN, "work"),            // 25m
      ev(day + 9 * HOUR + 25 * MIN, day + 9 * HOUR + 42 * MIN, "work"), // 17m
    ], day, day + 24 * HOUR);
    expect(rows).toHaveLength(1);
    expect(rows[0].startMs).toBe(day + 9 * HOUR);
    expect(rows[0].durationMs).toBe(42 * MIN);
    expect(rows[0].phase).toBe("work");
  });
  it("merges same-phase blocks across a dropped sub-minute event between them", () => {
    // 2:23 work 4m, 30s 'other' blip, 2:28 work 25m -> one Work row of 29m
    const rows = sessionRows([
      ev(day + 9 * HOUR, day + 9 * HOUR + 4 * MIN, "work"),
      ev(day + 9 * HOUR + 4 * MIN, day + 9 * HOUR + 4 * MIN + 30_000, "other"),
      ev(day + 9 * HOUR + 5 * MIN, day + 9 * HOUR + 30 * MIN, "work"),
    ], day, day + 24 * HOUR);
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe("work");
    expect(rows[0].durationMs).toBe(29 * MIN);
  });
  it("merges two long breaks split only by a sub-minute event", () => {
    const rows = sessionRows([
      ev(day + 9 * HOUR, day + 9 * HOUR + 12 * MIN, "long"),
      ev(day + 9 * HOUR + 12 * MIN, day + 9 * HOUR + 12 * MIN + 20_000, "work"),
      ev(day + 9 * HOUR + 13 * MIN, day + 9 * HOUR + 15 * MIN, "long"),
    ], day, day + 24 * HOUR);
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe("long");
    expect(rows[0].durationMs).toBe(14 * MIN);
  });
  it("starts a new row when a different phase intervenes", () => {
    const rows = sessionRows([
      ev(day + 9 * HOUR, day + 9 * HOUR + 25 * MIN, "work"),
      ev(day + 9 * HOUR + 25 * MIN, day + 9 * HOUR + 30 * MIN, "short"),
      ev(day + 9 * HOUR + 30 * MIN, day + 9 * HOUR + 55 * MIN, "work"),
    ], day, day + 24 * HOUR);
    expect(rows.map((r) => r.phase)).toEqual(["work", "short", "work"]);
  });
  it("clips an open event to now", () => {
    const rows = sessionRows([ev(day + 9 * HOUR, null, "work")], day, day + 9 * HOUR + 10 * MIN);
    expect(rows[0].durationMs).toBe(10 * MIN);
  });
  it("sets endMs to start + summed duration of the merged group", () => {
    const rows = sessionRows([
      ev(day + 9 * HOUR, day + 9 * HOUR + 25 * MIN, "work"),
      ev(day + 9 * HOUR + 25 * MIN, day + 9 * HOUR + 42 * MIN, "work"),
    ], day, day + 24 * HOUR);
    expect(rows[0].endMs).toBe(rows[0].startMs + 42 * MIN);
  });
  it("drops groups of one minute or less", () => {
    expect(sessionRows([ev(day + 9 * HOUR, day + 9 * HOUR + 30_000, "work")], day, day + 24 * HOUR)).toHaveLength(0);
    expect(sessionRows([ev(day + 9 * HOUR, day + 9 * HOUR, "work")], day, day + 24 * HOUR)).toHaveLength(0);
  });
});

describe("pieSlices", () => {
  it("past day: untracked fills the rest of a full 24h", () => {
    const day = startOfDay(1_700_000_000_000);
    const now = day + 100 * 24 * HOUR; // far future -> past day, span = 24h
    const slices = pieSlices([ev(day + 9 * HOUR, day + 11 * HOUR, "work")], day, now, 0); // cap 0 -> no idle
    const work = slices.find((s) => s.key === "work")!;
    const untracked = slices.find((s) => s.key === "untracked")!;
    expect(work.ms).toBe(2 * HOUR);
    expect(untracked.ms).toBe(22 * HOUR);
    expect(work.pct).toBeCloseTo((2 / 24) * 100, 5);
  });
  it("today: span is midnight->now and untracked = span - tracked - idle", () => {
    const base = 1_700_000_000_000;
    const day = startOfDay(base);
    const now = day + 5 * HOUR;
    const slices = pieSlices([ev(day + 1 * HOUR, day + 3 * HOUR, "work")], day, now, 0);
    expect(slices.find((s) => s.key === "work")!.ms).toBe(2 * HOUR);
    expect(slices.find((s) => s.key === "untracked")!.ms).toBe(3 * HOUR);
  });
  it("returns empty when the day span is zero", () => {
    const base = 1_700_000_000_000;
    const day = startOfDay(base);
    expect(pieSlices([], day, day, 0)).toEqual([]);
  });
  it("drops zero-ms slices", () => {
    const day = startOfDay(1_700_000_000_000);
    const now = day + 100 * 24 * HOUR;
    const slices = pieSlices([ev(day + 9 * HOUR, day + 11 * HOUR, "work")], day, now, 0);
    expect(slices.some((s) => s.key === "short")).toBe(false);
  });
});
