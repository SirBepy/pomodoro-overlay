import type { StatsEvent } from "../../shared/stats";
import { daySegments } from "./day-view";
import { endOfDay } from "./rollup";

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

const AXIS_TICKS = ["12a", "6a", "12p", "6p", "12a"]; // fixed, never shift

export function renderDayBar(root: HTMLElement, events: StatsEvent[], dayStart: number, now: number): void {
  const dayEnd = endOfDay(dayStart);
  const dayEvents = events.filter((e) => (e.end_ms ?? now) >= dayStart && e.start_ms <= dayEnd);

  if (dayEvents.length === 0) {
    const label = new Date(dayStart).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    root.innerHTML = `
      <div class="day-bar day-bar--empty"></div>
      <div class="day-axis">${AXIS_TICKS.map((t) => `<span>${t}</span>`).join("")}</div>
      <div class="day-bar-empty-msg">No activity on ${label}</div>
    `;
    return;
  }

  const segs = daySegments(dayEvents, dayStart, now).map((s) => {
    const tip = `${s.phase} · ${fmt12(s.startMs)}–${fmt12(s.endMs)} · ${fmtDuration(s.endMs - s.startMs)}`;
    return `<div class="day-bar-seg" style="left:${s.leftPct}%;width:${s.widthPct}%;background:${s.color};" title="${tip}"></div>`;
  }).join("");

  root.innerHTML = `
    <div class="day-bar">${segs}</div>
    <div class="day-axis">${AXIS_TICKS.map((t) => `<span>${t}</span>`).join("")}</div>
  `;
}
