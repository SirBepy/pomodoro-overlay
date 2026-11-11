// @ts-nocheck
const { listen } = window.__TAURI__.event;

import { getRange } from "../../shared/stats";
import { startOfDay, endOfDay } from "./rollup";
import { getSelectedDay } from "./selected-day";
import { renderSessions } from "./sessions";
import { phaseVarsStyle } from "./phase-colors";

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
    <div class="sessions-screen" style="${phaseVarsStyle()}">
      <div id="sessions-list"></div>
    </div>
  `;
  const listEl = root.querySelector<HTMLElement>("#sessions-list")!;

  refresh(listEl);
  listen("stats-updated", () => { refresh(listEl); }).then((un) => { unlistenStats = un; });
}
