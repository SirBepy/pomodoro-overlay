// @ts-nocheck
const { listen } = window.__TAURI__.event;

import { getRange } from "../../shared/stats";
import { startOfDay, endOfDay } from "./rollup";
import { getSelectedDay } from "./selected-day";
import { renderLegend } from "./legend";
import { renderSessions } from "./sessions";

let unlistenStats: (() => void) | null = null;

export function teardown(): void {
  if (unlistenStats) { unlistenStats(); unlistenStats = null; }
}

async function refresh(listEl: HTMLElement): Promise<void> {
  const day = getSelectedDay();
  const events = await getRange(startOfDay(day), endOfDay(day));
  const now = Date.now();
  renderSessions(listEl, events, day, now);
}

export function mountSessions(root: HTMLElement): void {
  teardown();

  root.innerHTML = `
    <div class="sessions-screen">
      <div id="sessions-legend"></div>
      <div id="sessions-list"></div>
    </div>
  `;
  renderLegend(root.querySelector<HTMLElement>("#sessions-legend")!);
  const listEl = root.querySelector<HTMLElement>("#sessions-list")!;

  refresh(listEl);
  listen("stats-updated", () => { refresh(listEl); }).then((un) => { unlistenStats = un; });
}
