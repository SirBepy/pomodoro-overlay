import type { StatsEvent } from "../../shared/stats";
import { sessionRows } from "./day-view";
import { fmt12, fmtDuration } from "./fmt";

// Rows show a colored dot + time range + duration. The phase is conveyed by the
// dot color (decoded by the legend), so no phase label is printed.
export function renderSessions(root: HTMLElement, events: StatsEvent[], dayStart: number, now: number): void {
  const rows = sessionRows(events, dayStart, now);
  if (rows.length === 0) {
    root.innerHTML = `<div class="session-empty">No sessions recorded</div>`;
    return;
  }
  root.innerHTML = `
    <div class="session-list">
      ${rows.map((r) => `
        <div class="session-row">
          <span class="session-dot" style="background:${r.color};"></span>
          <span class="session-range">${fmt12(r.startMs)} - ${fmt12(r.endMs)}</span>
          <span class="session-dur">${fmtDuration(r.durationMs)}</span>
        </div>
      `).join("")}
    </div>
  `;
}
