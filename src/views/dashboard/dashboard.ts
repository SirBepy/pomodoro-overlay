// @ts-nocheck
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import { getRange } from "../../shared/stats";
import { todayTotals, sevenDayBuckets, startOfDay, endOfDay } from "./rollup";
import { renderToday } from "./today";
import { renderIdle } from "./idle";
import { renderChart } from "./chart";

async function loadSettings() {
  try {
    return (await invoke("get_settings")) ?? {};
  } catch {
    return {};
  }
}

async function refresh(root: HTMLElement) {
  const settings = await loadSettings();
  const cap = settings?.idle_gap_cap_minutes ?? 240;
  // Visibility is opt-out: a missing flag means show (default true).
  const showToday = settings?.stats_show_today !== false;
  const showIdle = settings?.stats_show_idle !== false;
  const showChart = settings?.stats_show_chart !== false;
  const now = Date.now();
  const today = await getRange(startOfDay(now), endOfDay(now));
  const week = await getRange(startOfDay(now - 6 * 24 * 60 * 60 * 1000), endOfDay(now));

  const t = todayTotals(today, now, cap);
  const buckets = sevenDayBuckets(week, now, cap);
  const weekIdleAvg =
    buckets.reduce((acc, b) => acc + b.totals.idle_ms, 0) / Math.max(1, buckets.length);

  const todayEl = root.querySelector<HTMLElement>("#dash-today")!;
  const idleEl = root.querySelector<HTMLElement>("#dash-idle")!;
  const chartEl = root.querySelector<HTMLElement>("#dash-chart")!;
  todayEl.style.display = showToday ? "" : "none";
  idleEl.style.display = showIdle ? "" : "none";
  chartEl.style.display = showChart ? "" : "none";
  if (showToday) renderToday(todayEl, t);
  if (showIdle) renderIdle(idleEl, t.idle_ms, weekIdleAvg, cap);
  if (showChart) renderChart(chartEl, buckets);
}

let unlistenStats: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

function teardown() {
  if (unlistenStats) { unlistenStats(); unlistenStats = null; }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

export function mountDashboard(root: HTMLElement) {
  teardown();
  root.innerHTML = `
    <div class="dashboard">
      <div id="dash-today"></div>
      <div id="dash-idle"></div>
      <div id="dash-chart"></div>
    </div>
  `;
  refresh(root);

  listen("stats-updated", () => refresh(root)).then((un) => {
    unlistenStats = un;
  });

  visibilityHandler = () => {
    if (document.visibilityState === "visible") refresh(root);
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}
