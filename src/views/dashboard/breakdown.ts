import type { DayTotals } from "./rollup";
import { breakdownRows } from "./day-view";
import { fmtHoursMinutes } from "./fmt";

export function renderBreakdown(root: HTMLElement, totals: DayTotals): void {
  const rows = breakdownRows(totals);
  if (rows.length === 0) { root.innerHTML = ""; return; }
  root.innerHTML = `
    <div class="breakdown">
      ${rows.map((r) => `
        <div class="breakdown-row">
          <span class="breakdown-label">${r.label}</span>
          <span class="breakdown-track">
            <span class="breakdown-fill" style="width:${r.pct}%;background:${r.color};"></span>
          </span>
          <span class="breakdown-value">${fmtHoursMinutes(r.ms)}</span>
        </div>
      `).join("")}
    </div>
  `;
}
