import { PHASE_COLORS } from "./phase-colors";

// Color -> phase key for the dashboard bar/pie and the (label-less) session list.
const ITEMS: Array<{ label: string; color: string }> = [
  { label: "Work", color: PHASE_COLORS.work },
  { label: "Short", color: PHASE_COLORS.short },
  { label: "Long", color: PHASE_COLORS.long },
  { label: "Other", color: PHASE_COLORS.other },
  { label: "Snooze", color: PHASE_COLORS.snooze },
  { label: "Idle", color: "#f5a623" },
  { label: "Untracked", color: "#3a3a3a" },
];

export function renderLegend(root: HTMLElement): void {
  root.innerHTML = `
    <div class="legend">
      ${ITEMS.map((i) => `
        <span class="legend-item">
          <span class="legend-dot" style="background:${i.color};"></span>${i.label}
        </span>
      `).join("")}
    </div>
  `;
}
