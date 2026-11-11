import { html, render, type TemplateResult } from "lit-html";
import { styleMap } from "lit-html/directives/style-map.js";
import type { DayTotals } from "./rollup";
import { fmtHoursMinutes, splitHm } from "./fmt";
import { PHASE_ICONS, type ColorKey } from "./phase-colors";

export interface TileModel {
  key: "breaks" | "other" | "idle" | "snooze";
  /** Phase whose color, and icon (via PHASE_ICONS), the tile wears. */
  phase: ColorKey;
  label: string;
  valueMs: number;
  sub: string;
  /** value / tracked time, 0..1: width of the rail. */
  share: number;
  /** Odd tile out spans both grid columns. */
  wide: boolean;
}

function fmtCap(capMinutes: number): string {
  if (capMinutes >= 60 && capMinutes % 60 === 0) {
    const h = capMinutes / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${capMinutes} minutes`;
}

/** Visible tiles in display order (Breaks, Stopwatch, Idle, Snoozed). A tile
 *  whose value is 0 is not built at all. Work is the hero, not a tile, but it
 *  stays in the denominator so the rails read as share of the whole day. */
export function tileModels(totals: DayTotals, capMinutes: number): TileModel[] {
  const tracked =
    totals.work_ms + totals.short_ms + totals.long_ms + totals.other_ms + totals.snooze_ms + totals.idle_ms;
  const share = (ms: number) => (tracked > 0 ? ms / tracked : 0);
  const breaksMs = totals.short_ms + totals.long_ms;

  const all: Array<Omit<TileModel, "wide">> = [
    {
      key: "breaks", phase: "short", label: "Breaks", valueMs: breaksMs, share: share(breaksMs),
      sub: `${fmtHoursMinutes(totals.short_ms)} short${totals.long_ms > 0 ? ` · ${fmtHoursMinutes(totals.long_ms)} long` : ""}`,
    },
    {
      key: "other", phase: "other", label: "Stopwatch", valueMs: totals.other_ms, share: share(totals.other_ms),
      sub: `${Math.round(share(totals.other_ms) * 100)}% of tracked time`,
    },
    {
      key: "idle", phase: "idle", label: "Idle", valueMs: totals.idle_ms, share: share(totals.idle_ms),
      sub: `gaps under ${fmtCap(capMinutes)}`,
    },
    {
      key: "snooze", phase: "snooze", label: "Snoozed", valueMs: totals.snooze_ms, share: share(totals.snooze_ms),
      sub: "time spent snoozing",
    },
  ];
  // Values display floored to whole minutes, so a sub-minute total would read "0m":
  // hide it like a zero (phase switches leave seconds of idle on every busy day).
  const visible = all.filter((t) => Math.floor(t.valueMs / 60_000) > 0);
  return visible.map((t, i) => ({ ...t, wide: visible.length % 2 === 1 && i === visible.length - 1 }));
}

/** "1<small>h</small>25<small>m</small>"; minutes only under an hour. */
export function bigDuration(ms: number): TemplateResult {
  const { h, m } = splitHm(ms);
  return h > 0 ? html`${h}<small>h</small>${m}<small>m</small>` : html`${m}<small>m</small>`;
}

function tileTemplate(t: TileModel): TemplateResult {
  return html`
    <div class="dash-tile ${t.wide ? "dash-tile--wide" : ""}" style=${styleMap({ "--p": `var(--c-${t.phase})` })}>
      <div class="dash-tile-head">
        <span class="dash-chip"><i class="ph ph-${PHASE_ICONS[t.phase]}"></i></span>${t.label}
      </div>
      <div class="dash-tile-value">${bigDuration(t.valueMs)}</div>
      <div class="dash-tile-sub">${t.sub}</div>
      <div class="dash-rail"><i style=${styleMap({ width: `${t.share * 100}%` })}></i></div>
    </div>
  `;
}

export function renderTiles(root: HTMLElement, totals: DayTotals, capMinutes: number): void {
  const tiles = tileModels(totals, capMinutes);
  render(tiles.length === 0 ? html`` : html`<div class="dash-tiles">${tiles.map(tileTemplate)}</div>`, root);
}
