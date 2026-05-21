import { startOfDay } from "./rollup";

// Selected day shared between the dashboard and the sessions screen so they stay
// in sync. In-memory only (no persistence): the UX is "open to today", so the
// selection intentionally resets when the window is closed.
let selectedDayStart = startOfDay(Date.now());

export function getSelectedDay(): number {
  return selectedDayStart;
}

export function setSelectedDay(ms: number): void {
  selectedDayStart = ms;
}
