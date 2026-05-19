import { describe, it, expect } from "vitest";
import {
  phaseTotals,
  idleMs,
  workSessionsCompleted,
  todayTotals,
  startOfDay,
} from "../rollup";
import type { StatsEvent } from "../../../shared/stats";

const ev = (
  start_ms: number,
  end_ms: number | null,
  phase: StatsEvent["phase"] = "work",
  ended_by: StatsEvent["ended_by"] = "natural",
  session_id = `s-${start_ms}`,
): StatsEvent => ({
  session_id,
  phase,
  start_ms,
  end_ms,
  configured_seconds: 1500,
  ended_by,
});

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

describe("phaseTotals", () => {
  it("sums durations per phase clipped to range", () => {
    const t = startOfDay(Date.now());
    const events = [
      ev(t + 9 * HOUR, t + 9 * HOUR + 25 * MIN, "work"),
      ev(t + 9 * HOUR + 25 * MIN, t + 9 * HOUR + 30 * MIN, "short"),
    ];
    const out = phaseTotals(events, t, t + 24 * HOUR, Date.now());
    expect(out.work).toBe(25 * MIN);
    expect(out.short).toBe(5 * MIN);
  });

  it("treats open events as ending at now", () => {
    const t = 1_700_000_000_000;
    const events = [ev(t, null, "work")];
    const out = phaseTotals(events, t - HOUR, t + HOUR, t + 10 * MIN);
    expect(out.work).toBe(10 * MIN);
  });
});

describe("idleMs", () => {
  it("returns the full range when there are no events", () => {
    const t = 1_700_000_000_000;
    expect(idleMs([], t, t + HOUR, t + HOUR, 240)).toBe(HOUR);
  });

  it("includes leading and trailing gaps", () => {
    const t = 1_700_000_000_000;
    const events = [ev(t + 10 * MIN, t + 20 * MIN, "work")];
    expect(idleMs(events, t, t + HOUR, t + HOUR, 240)).toBe(50 * MIN);
  });

  it("drops gaps longer than cap", () => {
    const t = 1_700_000_000_000;
    const events = [
      ev(t, t + 5 * MIN, "work"),
      ev(t + 5 * HOUR + 5 * MIN, t + 5 * HOUR + 10 * MIN, "work"),
    ];
    // 5h gap > 4h cap → dropped. Trailing tail after second event (50m) kept.
    const idle = idleMs(events, t, t + 6 * HOUR, t + 6 * HOUR, 240);
    expect(idle).toBe(50 * MIN);
  });

  it("respects a smaller cap setting (3h cap)", () => {
    const t = 1_700_000_000_000;
    const events = [
      ev(t, t + 5 * MIN, "work"),
      ev(t + 4 * HOUR, t + 4 * HOUR + 5 * MIN, "work"),
    ];
    // 4h - 5m gap > 3h cap → dropped. Only trailing 55m kept.
    const idle = idleMs(events, t, t + 5 * HOUR, t + 5 * HOUR, 180);
    expect(idle).toBe(55 * MIN);
  });
});

describe("workSessionsCompleted", () => {
  it("counts distinct session_ids ending naturally with phase=work", () => {
    const events = [
      ev(0, 1, "work", "natural", "a"),
      ev(2, 3, "work", "pause", "a"),     // same session, not natural → still counts via 'a'
      ev(10, 11, "work", "natural", "b"),
      ev(20, 21, "short", "natural", "c"),
      ev(30, 31, "work", "skip", "d"),
    ];
    expect(workSessionsCompleted(events)).toBe(2);
  });
});

describe("todayTotals", () => {
  it("rolls up today's events", () => {
    const t = startOfDay(Date.now()) + 9 * HOUR;
    const now = t + 30 * MIN;
    const events = [
      ev(t, t + 25 * MIN, "work", "natural"),
      ev(t + 25 * MIN, t + 30 * MIN, "short", "natural"),
    ];
    const out = todayTotals(events, now, 240);
    expect(out.work_ms).toBe(25 * MIN);
    expect(out.short_ms).toBe(5 * MIN);
    expect(out.work_sessions_completed).toBe(1);
  });
});
