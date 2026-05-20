import type { DayTotals } from "./rollup";
import { fmtHoursMinutes } from "./fmt";

export function renderSummaryStrip(root: HTMLElement, totals: DayTotals): void {
  root.innerHTML = `
    <div class="summary-strip">
      <span class="summary-chip summary-chip-work">
        <i class="ph ph-timer"></i>
        ${fmtHoursMinutes(totals.work_ms)} focus
      </span>
      <span class="summary-chip summary-chip-sessions">
        <i class="ph ph-check-circle"></i>
        ${totals.work_sessions_completed} session${totals.work_sessions_completed !== 1 ? "s" : ""}
      </span>
      <span class="summary-chip summary-chip-idle">
        <i class="ph ph-coffee"></i>
        ${fmtHoursMinutes(totals.idle_ms)} idle
      </span>
    </div>
  `;
}
