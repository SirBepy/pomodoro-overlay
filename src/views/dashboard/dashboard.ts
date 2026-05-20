// @ts-nocheck
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import { getRange } from "../../shared/stats";
import { todayTotals, startOfDay, endOfDay } from "./rollup";
import { renderSummaryStrip } from "./summary-strip";
import { renderTimeline } from "./timeline";
// Inline type to avoid circular import (router.ts imports dashboard.ts)
type RenderHeaderFn = (
  selectedDayStart: number,
  earliestDayStart: number,
  onNavigate: (newDay: number) => void,
) => void;

let selectedDayStart: number = startOfDay(Date.now());
let earliestDayStart: number = startOfDay(Date.now());

let unlistenStats: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

export function teardown() {
  if (unlistenStats) { unlistenStats(); unlistenStats = null; }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

async function loadEarliestDay(): Promise<number> {
  // Fetch a wide range to find oldest event. Retention max is 365 days.
  const farPast = Date.now() - 366 * 86_400_000;
  try {
    const events = await invoke("get_stats_range", { startMs: farPast, endMs: Date.now() });
    if (events.length === 0) return startOfDay(Date.now());
    const oldest = Math.min(...events.map((e: any) => e.start_ms));
    return startOfDay(oldest);
  } catch {
    return startOfDay(Date.now());
  }
}

async function refresh(
  stripEl: HTMLElement,
  timelineEl: HTMLElement,
  headerEl: HTMLElement,
  renderHeader: RenderHeaderFn,
): Promise<void> {
  const now = Date.now();
  const settings = await invoke("get_settings").catch(() => ({})) as any;
  const cap: number = settings?.idle_gap_cap_minutes ?? 240;

  const events = await getRange(startOfDay(selectedDayStart), endOfDay(selectedDayStart));

  // For past days pass endOfDay-1ms so startOfDay() inside todayTotals stays on the right day.
  // For today pass `now` so open events are capped at current time.
  const isToday = selectedDayStart === startOfDay(now);
  const nowArg = isToday ? now : endOfDay(selectedDayStart) - 1;
  const totals = todayTotals(events, nowArg, cap);
  renderSummaryStrip(stripEl, totals);
  renderTimeline(timelineEl, events, selectedDayStart, now);
  renderHeader(selectedDayStart, earliestDayStart, (newDay) => {
    selectedDayStart = newDay;
    refresh(stripEl, timelineEl, headerEl, renderHeader);
  });
}

export function mountDashboard(
  root: HTMLElement,
  headerEl: HTMLElement,
  renderHeader: RenderHeaderFn,
): void {
  teardown();

  selectedDayStart = startOfDay(Date.now());

  root.innerHTML = `
    <div class="dashboard">
      <div id="dash-strip"></div>
      <div id="dash-timeline"></div>
    </div>
  `;

  const stripEl = root.querySelector<HTMLElement>("#dash-strip")!;
  const timelineEl = root.querySelector<HTMLElement>("#dash-timeline")!;

  loadEarliestDay().then((earliest) => {
    earliestDayStart = earliest;
    refresh(stripEl, timelineEl, headerEl, renderHeader);
  });

  listen("stats-updated", () => {
    refresh(stripEl, timelineEl, headerEl, renderHeader);
  }).then((un) => { unlistenStats = un; });

  visibilityHandler = () => {
    if (document.visibilityState === "visible") {
      refresh(stripEl, timelineEl, headerEl, renderHeader);
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}
