import { html, render, type TemplateResult } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import { fmt12, fmtDuration, fmtHourShort, fmtHoursMinutes } from "./fmt";
import { PHASE_LABELS } from "./phase-colors";
import type { StripModel } from "./day-view";

export interface RhythmProps {
  /** null = nothing to draw: the card shows the empty block instead. */
  model: StripModel | null;
  focusMs: number;
  emptyTitle: string;
  /** Before the first fetch: draw nothing instead of an empty-state flash. */
  hidden?: boolean;
}

function markTemplate(m: StripModel["marks"][number]): TemplateResult {
  const inset = m.tall ? 5 : 14;
  const tip = `${PHASE_LABELS[m.phase]} · ${fmt12(m.startMs)} to ${fmt12(m.endMs)} · ${fmtDuration(m.endMs - m.startMs)}`;
  return html`<div class="dash-mark" title=${tip} style=${styleMap({
    left: `calc(${m.leftPct}% + 1px)`,
    width: `max(2px, calc(${m.widthPct}% - 2px))`,
    top: `${inset}px`,
    bottom: `${inset}px`,
    background: `var(--c-${m.phase})`,
  })}></div>`;
}

function stripTemplate(model: StripModel, focusMs: number): TemplateResult {
  const first = model.marks[0].startMs;
  const last = Math.max(...model.marks.map((m) => m.endMs));
  const summary = `Focus ${fmtHoursMinutes(focusMs)} between ${fmt12(first)} and ${fmt12(last)}`;
  const lastTick = model.ticks.length - 1;
  return html`
    <div class="dash-strip" role="img" aria-label=${summary}>
      ${model.idleGaps.map(
        (g) => html`<div class="dash-idle" title=${`Idle ${fmtDuration(g.endMs - g.startMs)}`} style=${styleMap({
          left: `calc(${g.leftPct}% + 1px)`,
          width: `calc(${g.widthPct}% - 2px)`,
        })}></div>`,
      )}
      ${model.marks.map(markTemplate)}
      ${model.nowPct != null ? html`<div class="dash-now" style=${styleMap({ left: `calc(${model.nowPct}% - 1px)` })}></div>` : ""}
    </div>
    <div class="dash-axis" aria-hidden="true">
      ${model.ticks.map(
        (t, i) => html`<span class=${i === 0 ? "is-first" : i === lastTick ? "is-last" : ""} style=${styleMap({ left: `${t.pct}%` })}>${fmtHourShort(t.ms)}</span>`,
      )}
    </div>
  `;
}

export function renderRhythm(root: HTMLElement, p: RhythmProps): void {
  if (p.hidden) { render(html``, root); return; }
  render(
    html`
      <div class="dash-card">
        ${p.model
          ? html`
              <div class="dash-card-head"><b>Day rhythm</b><span class="dash-sub">tall is focus, short is a break</span></div>
              ${stripTemplate(p.model, p.focusMs)}
            `
          : html`
              <div class="dash-empty">
                <i class="ph ph-hourglass-simple"></i>
                <b>${p.emptyTitle}</b>
                <span>Start a work session or the stopwatch from the overlay and it shows up here.</span>
              </div>
            `}
      </div>
    `,
    root,
  );
}
