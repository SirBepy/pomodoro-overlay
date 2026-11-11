import { html, render, type TemplateResult } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import type { StatsEvent } from "../../shared/stats";
import { sessionRows, type SessionRow } from "./day-view";
import { fmt12, fmtDuration } from "./fmt";
import { PHASE_ICONS, PHASE_LABELS } from "./phase-colors";

/** One session line: phase chip + name + range + duration pill. Shared by the
 *  dashboard's "Latest sessions" card and the full sessions screen. */
export function sessionRowTemplate(r: SessionRow): TemplateResult {
  return html`
    <div class="dash-sess">
      <span class="dash-chip" style=${styleMap({ "--p": `var(--c-${r.phase})` })}><i class="ph ph-${PHASE_ICONS[r.phase]}"></i></span>
      <div class="dash-sess-mid">
        <div class="dash-sess-name">${PHASE_LABELS[r.phase]}${r.running ? html` <span class="dash-sess-run">· running</span>` : ""}</div>
        <div class="dash-sess-range">${fmt12(r.startMs)} to ${r.running ? "now" : fmt12(r.endMs)}</div>
      </div>
      <span class="dash-sess-dur">${fmtDuration(r.durationMs)}</span>
    </div>
  `;
}

/** Newest first, so the most recent session leads the dashboard card. */
export function latestSessions(rows: SessionRow[], count = 4): SessionRow[] {
  return rows.slice(-count).reverse();
}

/** Dashboard card with the newest rows and a link to the full list. Renders
 *  nothing when the day has no rows. */
export function renderLatestSessions(root: HTMLElement, rows: SessionRow[], onAll: () => void): void {
  if (rows.length === 0) { render(html``, root); return; }
  render(
    html`
      <div class="dash-card">
        <div class="dash-card-head">
          <b>Latest sessions</b>
          <button class="dash-link" type="button" @click=${onAll}>All details <i class="ph ph-arrow-right"></i></button>
        </div>
        ${latestSessions(rows).map(sessionRowTemplate)}
      </div>
    `,
    root,
  );
}

// Names sit on every row, so the screen needs no legend.
export function renderSessions(root: HTMLElement, events: StatsEvent[], dayStart: number, now: number): void {
  const rows = sessionRows(events, dayStart, now);
  if (rows.length === 0) {
    render(html`<div class="session-empty">No sessions recorded</div>`, root);
    return;
  }
  render(html`<div class="session-list">${rows.map(sessionRowTemplate)}</div>`, root);
}
