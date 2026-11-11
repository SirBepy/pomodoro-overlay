import { html, render } from "lit-html";
import type { DayTotals } from "./rollup";
import { fmt12, fmtHoursMinutes } from "./fmt";
import { bigDuration } from "./tiles";

export interface HeroModel {
  /** No focus time that day: the card drops its red fill. */
  off: boolean;
  title: string;
  workMs: number;
  sessions: number;
  /** Start of the day's first event; null hides the pill. */
  sinceMs: number | null;
  snoozeMs: number;
}

/** `dayLabel` is the long date ("Tue 10 Nov") used for past days. */
export function heroModel(
  totals: DayTotals,
  isToday: boolean,
  dayLabel: string,
  firstStartMs: number | null,
): HeroModel {
  const off = totals.work_ms <= 0;
  return {
    off,
    title: off ? "No focus time" : isToday ? "Focused today" : `Focused on ${dayLabel}`,
    workMs: totals.work_ms,
    sessions: totals.work_sessions_completed,
    sinceMs: firstStartMs,
    snoozeMs: totals.snooze_ms,
  };
}

export function renderHero(root: HTMLElement, m: HeroModel): void {
  render(
    html`
      <div class="dash-hero ${m.off ? "dash-hero--off" : ""}">
        <div class="dash-hero-row">
          <span class="dash-hero-title">${m.title}</span>
          <span class="dash-hero-icon"><i class="ph ph-timer"></i></span>
        </div>
        <div class="dash-hero-big">${bigDuration(m.workMs)}</div>
        <div class="dash-hero-pills">
          <span><i class="ph ph-check-circle"></i>${m.sessions} session${m.sessions === 1 ? "" : "s"}</span>
          ${m.sinceMs != null ? html`<span><i class="ph ph-clock"></i>since ${fmt12(m.sinceMs)}</span>` : ""}
          ${m.snoozeMs >= 60_000 ? html`<span><i class="ph ph-alarm"></i>${fmtHoursMinutes(m.snoozeMs)} snoozed</span>` : ""}
        </div>
      </div>
    `,
    root,
  );
}
