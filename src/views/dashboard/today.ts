import type { DayTotals } from "./rollup";
import { fmtHoursMinutes } from "./fmt";

export function renderToday(root: HTMLElement, t: DayTotals) {
  root.innerHTML = `
    <div class="card">
      <div class="card-label">TODAY</div>
      <div class="today-grid">
        <div><div class="big">${fmtHoursMinutes(t.work_ms)}</div><div class="small">focus</div></div>
        <div><div class="big">${fmtHoursMinutes(t.short_ms)}</div><div class="small">short</div></div>
        <div><div class="big">${fmtHoursMinutes(t.long_ms)}</div><div class="small">long</div></div>
        <div><div class="big">${fmtHoursMinutes(t.other_ms)}</div><div class="small">other</div></div>
        <div><div class="big">${fmtHoursMinutes(t.snooze_ms)}</div><div class="small">snooze</div></div>
        <div><div class="big">${fmtHoursMinutes(t.idle_ms)}</div><div class="small">idle</div></div>
      </div>
      <div class="card-footer">${t.work_sessions_completed} work session${t.work_sessions_completed === 1 ? "" : "s"} completed</div>
    </div>
  `;
}
