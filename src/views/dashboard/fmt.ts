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

// "25m" / "1h 5m" for segment/session duration readouts.
export function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

// "9:05 AM" / "12:30 PM" for timestamp labels.
export function fmt12(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${m} ${ampm}`;
}
