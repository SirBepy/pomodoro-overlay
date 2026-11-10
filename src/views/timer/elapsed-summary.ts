import type { StatsEvent } from "../../shared/stats";
import { formatTotalHM } from "../../shared/focus-sign";
import { endOfDay, phaseTotals, startOfDay } from "../dashboard/rollup";

/**
 * Focus + stopwatch time logged today. Events with end_ms = null (the interval
 * running right now) are counted up to `now` by phaseTotals, so the live
 * interval is included without a separate add that would double-count it.
 */
export function totalTodayMs(events: StatsEvent[], now: number): number {
  const pt = phaseTotals(events, startOfDay(now), endOfDay(now), now);
  return pt.work + pt.other;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function runClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

// Shared with the focus sign's label so the two totals can never disagree.
export { formatTotalHM };

interface TextNode {
  textContent: string | null;
}

export interface ElapsedNodes {
  /** "this run 12:34" (gains an hour part past 59:59) */
  run: TextNode;
  /** "total 3:47", the large-window line */
  total: TextNode;
  /** "3:47" alone, the big digits swapped in on hover in small windows */
  bigTotal: TextNode;
}

function setIfChanged(node: TextNode, text: string) {
  if (node.textContent !== text) node.textContent = text;
}

/** The run ticks every second; the total nodes are only written when the minute rolls over. */
export function renderElapsedSummary(els: ElapsedNodes, runSec: number, totalMs: number) {
  const hm = formatTotalHM(totalMs);
  setIfChanged(els.run, `this run ${runClock(runSec)}`);
  setIfChanged(els.total, `total ${hm}`);
  setIfChanged(els.bigTotal, hm);
}
