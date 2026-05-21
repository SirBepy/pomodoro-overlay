// @ts-nocheck
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import { getRange } from "../../shared/stats";
import { todayTotals, startOfDay, endOfDay } from "./rollup";
import { renderSummaryStrip } from "./summary-strip";
import { renderLegend } from "./legend";
import { renderDayBar } from "./day-bar";
import { renderBreakdown } from "./breakdown";
import { renderPie } from "./pie";
import { pieSlices } from "./day-view";
import { getSelectedDay, setSelectedDay } from "./selected-day";

type RenderHeaderFn = () => void;

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

function localDateStr(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const minDate = localDateStr(earliest);
  const maxDate = localDateStr(todayStart);
  const currentDate = localDateStr(selected);

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
  pieEl: HTMLElement,
  renderHeader: RenderHeaderFn,
): Promise<void> {
  const now = Date.now();
  const settings = await invoke("get_settings").catch(() => ({})) as any;
  const cap: number = settings?.idle_gap_cap_minutes ?? 240;

  const day = getSelectedDay();
  const events = await getRange(startOfDay(day), endOfDay(day));

  const isToday = day === startOfDay(now);
  const nowArg = isToday ? now : endOfDay(day) - 1;
  const totals = todayTotals(events, nowArg, cap);

  renderSummaryStrip(stripEl, totals);
  renderDayBar(barEl, events, day, now);
  renderBreakdown(breakdownEl, totals);
  renderPie(pieEl, pieSlices(events, day, now, cap));
  renderHeader();
  renderPagination(paginationEl, day, earliestDayStart, (newDay) => {
    setSelectedDay(newDay);
    refresh(paginationEl, stripEl, barEl, breakdownEl, pieEl, renderHeader);
  });
}

export function mountDashboard(
  root: HTMLElement,
  renderHeader: RenderHeaderFn,
): void {
  teardown();

  root.innerHTML = `
    <div class="dashboard">
      <div id="dash-pagination"></div>
      <div id="dash-strip"></div>
      <div id="dash-legend"></div>
      <div id="dash-bar-row">
        <div id="dash-bar"></div>
        <button id="dash-details-btn" class="dash-details-btn" title="Detailed sessions">
          <i class="ph ph-list-bullets"></i>
        </button>
      </div>
      <div id="dash-breakdown"></div>
      <div id="dash-pie"></div>
    </div>
  `;

  const paginationEl = root.querySelector<HTMLElement>("#dash-pagination")!;
  const stripEl = root.querySelector<HTMLElement>("#dash-strip")!;
  const barEl = root.querySelector<HTMLElement>("#dash-bar")!;
  const breakdownEl = root.querySelector<HTMLElement>("#dash-breakdown")!;
  const pieEl = root.querySelector<HTMLElement>("#dash-pie")!;

  renderLegend(root.querySelector<HTMLElement>("#dash-legend")!);
  root.querySelector("#dash-details-btn")!.addEventListener("click", () => {
    location.hash = "#sessions";
  });

  loadEarliestDay().then((earliest) => {
    earliestDayStart = earliest;
    refresh(paginationEl, stripEl, barEl, breakdownEl, pieEl, renderHeader);
  });

  listen("stats-updated", () => {
    refresh(paginationEl, stripEl, barEl, breakdownEl, pieEl, renderHeader);
  }).then((un) => { unlistenStats = un; });

  visibilityHandler = () => {
    if (document.visibilityState === "visible") {
      refresh(paginationEl, stripEl, barEl, breakdownEl, pieEl, renderHeader);
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}
