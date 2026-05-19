// @ts-nocheck
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import { getRange, resetStats } from "../../shared/stats";
import { todayTotals, sevenDayBuckets, startOfDay, endOfDay } from "./rollup";
import { renderToday } from "./today";
import { renderIdle } from "./idle";
import { renderChart } from "./chart";

async function loadCap(): Promise<number> {
  try {
    const s = await invoke("get_settings");
    return s?.idle_gap_cap_minutes ?? 240;
  } catch {
    return 240;
  }
}

async function refresh(root: HTMLElement) {
  const cap = await loadCap();
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
  renderToday(todayEl, t);
  renderIdle(idleEl, t.idle_ms, weekIdleAvg, cap);
  renderChart(chartEl, buckets);
}

export function mountDashboard(root: HTMLElement) {
  root.innerHTML = `
    <div class="dashboard">
      <div id="dash-today"></div>
      <div id="dash-idle"></div>
      <div id="dash-chart"></div>
      <div class="dashboard-footer">
        <button id="clear-stats" class="danger-btn">Clear stats</button>
      </div>
    </div>
  `;
  refresh(root);

  listen("stats-updated", () => refresh(root));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh(root);
  });

  const btn = root.querySelector<HTMLButtonElement>("#clear-stats")!;
  btn.addEventListener("click", async () => {
    const ok = window.confirm("Permanently delete all stats history? This cannot be undone.");
    if (!ok) return;
    await resetStats();
    refresh(root);
  });
}
