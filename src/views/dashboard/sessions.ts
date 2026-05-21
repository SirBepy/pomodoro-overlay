import type { StatsEvent } from "../../shared/stats";
import { sessionRows } from "./day-view";

const PHASE_LABEL: Record<string, string> = {
  work: "Work", short: "Short break", long: "Long break", other: "Other", snooze: "Snooze", idle: "Idle",
};

function fmt12(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m} ${ampm}`;
}

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

export function renderSessions(root: HTMLElement, events: StatsEvent[], dayStart: number, now: number): void {
  const rows = sessionRows(events, dayStart, now);
  if (rows.length === 0) { root.innerHTML = ""; return; }
  root.innerHTML = `
    <div class="session-list">
      ${rows.map((r) => `
        <div class="session-row">
          <span class="session-dot" style="background:${r.color};"></span>
          <span class="session-time">${fmt12(r.startMs)}</span>
          <span class="session-phase">${PHASE_LABEL[r.phase] ?? r.phase}</span>
          <span class="session-dur">${fmtDuration(r.durationMs)}</span>
        </div>
      `).join("")}
    </div>
  `;
}
