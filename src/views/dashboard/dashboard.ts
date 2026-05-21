// @ts-nocheck
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import { getRange } from "../../shared/stats";
import { todayTotals, startOfDay, endOfDay } from "./rollup";
import { renderSummaryStrip } from "./summary-strip";
import { renderDayBar } from "./day-bar";
import { renderBreakdown } from "./breakdown";
import { renderSessions } from "./sessions";

type RenderHeaderFn = () => void;

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

function renderPagination(
  root: HTMLElement,
  selected: number,
  earliest: number,
  onNavigate: (newDay: number) => void,
): void {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const isPrevDisabled = selected <= earliest;
  const isNextDisabled = selected >= todayStart;
  const minDate = new Date(earliest).toISOString().slice(0, 10);
  const maxDate = new Date(todayStart).toISOString().slice(0, 10);
  const currentDate = new Date(selected).toISOString().slice(0, 10);

  root.innerHTML = `
    <button class="ctx-nav-btn" id="pag-prev" ${isPrevDisabled ? "disabled" : ""}>
      <i class="ph ph-caret-left"></i>
    </button>
    <input type="date" class="ctx-date-picker" id="pag-date"
      value="${currentDate}" min="${minDate}" max="${maxDate}">
    <button class="ctx-nav-btn" id="pag-next" ${isNextDisabled ? "disabled" : ""}>
      <i class="ph ph-caret-right"></i>
    </button>
  `;
  root.querySelector("#pag-prev")!.addEventListener("click", () => {
    if (!isPrevDisabled) onNavigate(selected - 86_400_000);
  });
  root.querySelector("#pag-next")!.addEventListener("click", () => {
    if (!isNextDisabled) onNavigate(selected + 86_400_000);
  });
  root.querySelector("#pag-date")!.addEventListener("change", (ev) => {
    const val = (ev.target as HTMLInputElement).value;
    if (val) onNavigate(startOfDay(new Date(val).getTime()));
  });
}

async function refresh(
  paginationEl: HTMLElement,
  stripEl: HTMLElement,
  barEl: HTMLElement,
  breakdownEl: HTMLElement,
  sessionsEl: HTMLElement,
  renderHeader: RenderHeaderFn,
): Promise<void> {
  const now = Date.now();
  const settings = await invoke("get_settings").catch(() => ({})) as any;
  const cap: number = settings?.idle_gap_cap_minutes ?? 240;

  const events = await getRange(startOfDay(selectedDayStart), endOfDay(selectedDayStart));

  const isToday = selectedDayStart === startOfDay(now);
  const nowArg = isToday ? now : endOfDay(selectedDayStart) - 1;
  const totals = todayTotals(events, nowArg, cap);

  renderSummaryStrip(stripEl, totals);
  renderDayBar(barEl, events, selectedDayStart, now);
  renderBreakdown(breakdownEl, totals);
  renderSessions(sessionsEl, events, selectedDayStart, now);
  renderHeader();
  renderPagination(paginationEl, selectedDayStart, earliestDayStart, (newDay) => {
    selectedDayStart = newDay;
    refresh(paginationEl, stripEl, barEl, breakdownEl, sessionsEl, renderHeader);
  });
}

export function mountDashboard(
  root: HTMLElement,
  renderHeader: RenderHeaderFn,
): void {
  teardown();

  selectedDayStart = startOfDay(Date.now());

  root.innerHTML = `
    <div class="dashboard">
      <div id="dash-pagination"></div>
      <div id="dash-strip"></div>
      <div id="dash-bar"></div>
      <div id="dash-breakdown"></div>
      <div id="dash-sessions"></div>
    </div>
  `;

  const paginationEl = root.querySelector<HTMLElement>("#dash-pagination")!;
  const stripEl = root.querySelector<HTMLElement>("#dash-strip")!;
  const barEl = root.querySelector<HTMLElement>("#dash-bar")!;
  const breakdownEl = root.querySelector<HTMLElement>("#dash-breakdown")!;
  const sessionsEl = root.querySelector<HTMLElement>("#dash-sessions")!;

  loadEarliestDay().then((earliest) => {
    earliestDayStart = earliest;
    refresh(paginationEl, stripEl, barEl, breakdownEl, sessionsEl, renderHeader);
  });

  listen("stats-updated", () => {
    refresh(paginationEl, stripEl, barEl, breakdownEl, sessionsEl, renderHeader);
  }).then((un) => { unlistenStats = un; });

  visibilityHandler = () => {
    if (document.visibilityState === "visible") {
      refresh(paginationEl, stripEl, barEl, breakdownEl, sessionsEl, renderHeader);
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}
