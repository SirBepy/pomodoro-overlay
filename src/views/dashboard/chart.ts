import type { DayBucket } from "./rollup";
import { PHASE_COLORS } from "./phase-colors";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtMs(ms: number): string {
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h${m}m`;
}

export function renderChart(root: HTMLElement, buckets: DayBucket[]) {
  let maxTotal = 0;
  for (const b of buckets) {
    const total =
      b.totals.work_ms + b.totals.other_ms +
      b.totals.short_ms + b.totals.long_ms +
      b.totals.snooze_ms + b.totals.idle_ms;
    if (total > maxTotal) maxTotal = total;
  }
  if (maxTotal === 0) maxTotal = 1;

  const bars = buckets.map((b) => {
    const work = b.totals.work_ms;
    const other = b.totals.other_ms;
    const breaks = b.totals.short_ms + b.totals.long_ms;
    const idleAndSnooze = b.totals.snooze_ms + b.totals.idle_ms;
    const day = new Date(b.date_start);
    const label = WEEKDAY[day.getDay()];
    const tooltip = [
      `${fmtMs(work)} focus`,
      `${fmtMs(other)} other`,
      `${fmtMs(breaks)} breaks`,
      `${fmtMs(idleAndSnooze)} idle/snooze`,
    ].join(" / ");
    const h = (v: number) => `${(v / maxTotal * 100).toFixed(1)}%`;
    return `
      <div class="bar-col" title="${tooltip}">
        <div class="bar-stack">
          <div class="bar-seg" style="height:${h(idleAndSnooze)};background:${PHASE_COLORS.idle}"></div>
          <div class="bar-seg" style="height:${h(breaks)};background:${PHASE_COLORS.short}"></div>
          <div class="bar-seg" style="height:${h(other)};background:${PHASE_COLORS.other}"></div>
          <div class="bar-seg" style="height:${h(work)};background:${PHASE_COLORS.work}"></div>
        </div>
        <div class="bar-label">${label}</div>
      </div>
    `;
  }).join("");

  root.innerHTML = `
    <div class="card">
      <div class="card-label">LAST 7 DAYS</div>
      <div class="chart-row">${bars}</div>
    </div>
  `;
}
