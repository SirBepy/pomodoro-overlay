import type { DayTotals } from "./rollup";

function fmtMs(ms: number): string {
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function renderToday(root: HTMLElement, t: DayTotals) {
  root.innerHTML = `
    <div class="card">
      <div class="card-label">TODAY</div>
      <div class="today-grid">
        <div><div class="big">${fmtMs(t.work_ms)}</div><div class="small">focus</div></div>
        <div><div class="big">${fmtMs(t.short_ms)}</div><div class="small">short</div></div>
        <div><div class="big">${fmtMs(t.long_ms)}</div><div class="small">long</div></div>
        <div><div class="big">${fmtMs(t.other_ms)}</div><div class="small">other</div></div>
        <div><div class="big">${fmtMs(t.snooze_ms)}</div><div class="small">snooze</div></div>
        <div><div class="big">${fmtMs(t.idle_ms)}</div><div class="small">idle</div></div>
      </div>
      <div class="card-footer">${t.work_sessions_completed} work session${t.work_sessions_completed === 1 ? "" : "s"} completed</div>
    </div>
  `;
}
