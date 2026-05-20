import type { StatsEvent } from "../../shared/stats";
import { PHASE_COLORS } from "./phase-colors";
import { startOfDay, endOfDay } from "./rollup";

const MIN_BLOCK_PX = 5;
const MS_PER_PX = 60_000; // 1 minute per pixel

function fmt12(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

export function renderTimeline(
  root: HTMLElement,
  events: StatsEvent[],
  dayStart: number,
  now: number,
): void {
  const dayEnd = endOfDay(dayStart);
  const isToday = dayStart <= now && now < dayEnd;

  // Filter events that overlap this day
  const dayEvents = events.filter((e) => {
    const eEnd = e.end_ms ?? now;
    return eEnd >= dayStart && e.start_ms <= dayEnd;
  });

  if (dayEvents.length === 0) {
    const label = new Date(dayStart).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    root.innerHTML = `<div class="timeline-empty">No activity on ${label}</div>`;
    return;
  }

  // Clip window
  const clipStart = Math.max(Math.min(...dayEvents.map((e) => e.start_ms)), dayStart);
  const rawEnd = isToday ? now : Math.max(...dayEvents.map((e) => e.end_ms ?? now));
  const clipEnd = Math.min(rawEnd, dayEnd);
  const totalMs = Math.max(clipEnd - clipStart, 1);
  const totalPx = Math.ceil(totalMs / MS_PER_PX);

  // Hour ticks within clip window
  const hourTicks: number[] = [];
  const firstHour = Math.ceil(clipStart / 3_600_000) * 3_600_000;
  for (let t = firstHour; t <= clipEnd; t += 3_600_000) {
    hourTicks.push(t);
  }

  // Build gridlines HTML
  const gridlines = hourTicks.map((t) => {
    const top = Math.round((t - clipStart) / MS_PER_PX);
    const label = fmt12(t);
    return `
      <div class="tl-gridline" style="top:${top}px;">
        <span class="tl-hour-label">${label}</span>
      </div>
    `;
  }).join("");

  // Build event blocks HTML
  const blocks = dayEvents.map((e) => {
    const eStart = Math.max(e.start_ms, clipStart);
    const eEnd = Math.min(e.end_ms ?? now, clipEnd);
    if (eEnd <= eStart) return "";
    const top = Math.round((eStart - clipStart) / MS_PER_PX);
    const height = Math.max(MIN_BLOCK_PX, Math.round((eEnd - eStart) / MS_PER_PX));
    const color = (PHASE_COLORS as Record<string, string>)[e.phase] ?? "#888";
    const tooltip = `${e.phase} · ${fmt12(eStart)}–${fmt12(eEnd)} · ${fmtDuration(eEnd - eStart)}`;
    return `<div class="tl-block" style="top:${top}px;height:${height}px;background:${color};" title="${tooltip}"></div>`;
  }).join("");

  root.innerHTML = `
    <div class="timeline-scroll">
      <div class="tl-axis-col">
        ${hourTicks.map((t) => {
          const top = Math.round((t - clipStart) / MS_PER_PX);
          return `<span class="tl-axis-label" style="top:${top}px;">${fmt12(t)}</span>`;
        }).join("")}
      </div>
      <div class="tl-track" style="height:${totalPx}px;">
        ${gridlines}
        ${blocks}
      </div>
    </div>
  `;
}
