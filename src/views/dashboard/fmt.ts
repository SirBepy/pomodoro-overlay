// Shared duration formatters for the dashboard cards.

// "1h 5m" (space-separated); minutes-only when under an hour ("5m").
export function fmtHoursMinutes(ms: number): string {
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// "5 min" for idle-style readouts.
export function fmtMinutes(ms: number): string {
  const m = Math.round(ms / 60000);
  return `${m} min`;
}
