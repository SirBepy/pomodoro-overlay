import type { PieSlice } from "./day-view";
import { fmtDuration } from "./fmt";

const CX = 50;
const CY = 50;
const R = 48;

// Point on the circle for an angle in degrees, 0 = 12 o'clock, clockwise.
function point(angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [CX + R * Math.cos(a), CY + R * Math.sin(a)];
}

function svg(inner: string): string {
  return `<svg class="day-pie-svg" viewBox="0 0 100 100" role="img">${inner}</svg>`;
}

function circle(color: string, title?: string): string {
  return svg(`${title ? `<title>${title}</title>` : ""}<circle cx="${CX}" cy="${CY}" r="${R}" fill="${color}"/>`);
}

export function renderPie(root: HTMLElement, slices: PieSlice[]): void {
  if (slices.length === 0) {
    root.innerHTML = circle("#3a3a3a");
    return;
  }
  if (slices.length === 1) {
    const s = slices[0];
    root.innerHTML = circle(s.color, `${s.label} - ${fmtDuration(s.ms)}`);
    return;
  }

  let angle = 0;
  const paths = slices.map((s) => {
    const start = angle;
    const end = angle + (s.pct / 100) * 360;
    angle = end;
    const [x1, y1] = point(start);
    const [x2, y2] = point(end);
    const large = end - start > 180 ? 1 : 0;
    const d = `M ${CX} ${CY} L ${x1.toFixed(3)} ${y1.toFixed(3)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
    return `<path d="${d}" fill="${s.color}"><title>${s.label} - ${fmtDuration(s.ms)}</title></path>`;
  }).join("");

  root.innerHTML = svg(paths);
}
