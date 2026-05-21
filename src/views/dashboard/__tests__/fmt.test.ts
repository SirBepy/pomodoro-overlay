import { describe, it, expect } from "vitest";
import { fmtDuration, fmt12, fmtHoursMinutes, fmtMinutes } from "../fmt";

describe("fmtDuration", () => {
  it("shows minutes only when under 1h", () => {
    expect(fmtDuration(25 * 60_000)).toBe("25m");
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(59 * 60_000)).toBe("59m");
  });

  it("shows hours and minutes at 60m+", () => {
    expect(fmtDuration(60 * 60_000)).toBe("1h 0m");
    expect(fmtDuration(65 * 60_000)).toBe("1h 5m");
    expect(fmtDuration(90 * 60_000)).toBe("1h 30m");
  });
});

describe("fmt12", () => {
  it("formats midnight as 12 AM", () => {
    const d = new Date("2024-01-01T00:05:00");
    expect(fmt12(d.getTime())).toBe("12:05 AM");
  });

  it("formats noon as 12 PM", () => {
    const d = new Date("2024-01-01T12:00:00");
    expect(fmt12(d.getTime())).toBe("12:00 PM");
  });

  it("formats afternoon hour correctly", () => {
    const d = new Date("2024-01-01T14:30:00");
    expect(fmt12(d.getTime())).toBe("2:30 PM");
  });

  it("pads minutes", () => {
    const d = new Date("2024-01-01T09:05:00");
    expect(fmt12(d.getTime())).toBe("9:05 AM");
  });
});

describe("fmtHoursMinutes", () => {
  it("shows minutes only when under 1h", () => {
    expect(fmtHoursMinutes(5 * 60_000)).toBe("5m");
  });

  it("shows hours and minutes at 1h+", () => {
    expect(fmtHoursMinutes(65 * 60_000)).toBe("1h 5m");
  });
});

describe("fmtMinutes", () => {
  it("rounds and appends min", () => {
    expect(fmtMinutes(5 * 60_000)).toBe("5 min");
    expect(fmtMinutes(90_000)).toBe("2 min");
  });
});
