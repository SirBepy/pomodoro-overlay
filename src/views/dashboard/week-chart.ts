import { html, render, type TemplateResult } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import { fmtDayShort, fmtHoursMinutes } from "./fmt";
import { weekGridlines, weekScale, weekSummary, type WeekDay } from "./week";

const PLOT_H = 104; // px; matches .dash-wk-plot in dashboard.css
const MIN_BAR_PX = 4;

export interface WeekChartProps {
  days: WeekDay[];
  selectedDay: number;
  /** First run: nothing recorded ever, so the card explains how it fills. */
  empty: boolean;
  canPrev: boolean;
  canNext: boolean;
  onSelect: (dayStart: number) => void;
  onPage: (dir: -1 | 1) => void;
}

/** Bar height in px for a day; 0 means "draw the stub instead". */
export function barHeightPx(workMs: number, scaleMs: number): number {
  if (workMs <= 0) return 0;
  return Math.max(MIN_BAR_PX, (workMs / scaleMs) * PLOT_H);
}

function column(d: WeekDay, p: WeekChartProps, scale: number): TemplateResult {
  const selected = d.dayStart === p.selectedDay;
  const label = d.workMs > 0 ? `${fmtDayShort(d.dayStart)}, ${fmtHoursMinutes(d.workMs)} focus` : `${fmtDayShort(d.dayStart)}, no focus`;
  const h = barHeightPx(d.workMs, scale);
  const date = new Date(d.dayStart);
  return html`
    <button class="dash-wc ${selected ? "is-selected" : ""}" type="button" title=${label} aria-label=${label}
      aria-pressed=${selected ? "true" : "false"} @click=${() => p.onSelect(d.dayStart)}>
      <span class="dash-wk-plot">
        ${selected && d.workMs > 0 ? html`<em>${fmtHoursMinutes(d.workMs)}</em>` : ""}
        ${h > 0 ? html`<i style=${styleMap({ height: `${h}px` })}></i>` : html`<u></u>`}
      </span>
      <span class="dash-wk-x">
        ${date.toLocaleDateString(undefined, { weekday: "narrow" })}<b>${date.getDate()}</b>
      </span>
    </button>
  `;
}

export function renderWeekChart(root: HTMLElement, p: WeekChartProps): void {
  const scale = weekScale(Math.max(0, ...p.days.map((d) => d.workMs)));
  const { totalMs, avgMs } = weekSummary(p.days);
  const sub = p.empty ? "Nothing recorded yet" : `${fmtHoursMinutes(totalMs)} · ${fmtHoursMinutes(avgMs)} a day`;
  render(
    html`
      <div class="dash-card">
        <div class="dash-card-head">
          <div>
            <b>Focus this week</b>
            <div class="dash-sub">${sub}</div>
          </div>
          <div class="dash-mini-group">
            <button class="dash-mini" type="button" aria-label="Previous week" ?disabled=${!p.canPrev}
              @click=${() => p.onPage(-1)}><i class="ph ph-caret-left"></i></button>
            <button class="dash-mini" type="button" aria-label="Next week" ?disabled=${!p.canNext}
              @click=${() => p.onPage(1)}><i class="ph ph-caret-right"></i></button>
          </div>
        </div>
        <div class="dash-wk">
          <div class="dash-wk-grid" aria-hidden="true">
            ${weekGridlines(scale).map(
              (v) => html`<div style=${styleMap({ bottom: `${(v / scale) * PLOT_H}px` })}><span>${v / 3_600_000}h</span></div>`,
            )}
          </div>
          <div class="dash-wk-cols">${p.days.map((d) => column(d, p, scale))}</div>
        </div>
        ${p.empty ? html`<div class="dash-wk-empty">Your week fills in as you finish work sessions.</div>` : ""}
      </div>
    `,
    root,
  );
}
