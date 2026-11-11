// @ts-nocheck
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

import { getRange } from "../../shared/stats";
import { todayTotals, startOfDay, addDays } from "./rollup";
import { getSelectedDay, setSelectedDay } from "./selected-day";
import { sessionRows, stripModel } from "./day-view";
import { weekWindow, weekFocus } from "./week";
import { renderDateRow } from "./date-row";
import { renderWeekChart } from "./week-chart";
import { renderHero, heroModel } from "./hero";
import { renderTiles } from "./tiles";
import { renderRhythm } from "./day-strip";
import { renderLatestSessions } from "./sessions";
import { fmtDayShort } from "./fmt";
import { phaseVarsStyle } from "./phase-colors";

type RenderHeaderFn = () => void;

interface Els {
  date: HTMLElement;
  week: HTMLElement;
  hero: HTMLElement;
  tiles: HTMLElement;
  rhythm: HTMLElement;
  latest: HTMLElement;
}

const DEFAULT_IDLE_CAP_MIN = 240;

let earliestDayStart: number = startOfDay(Date.now());
// True once any event exists, so the first-run copy never shows for someone
// merely browsing an empty week.
let hasAnyEvents = false;
// Last day of the week window when the user paged back; null = the window ends today.
let pagedEnd: number | null = null;
// Sequence token: a slow earlier fetch must not overwrite a newer paint.
let refreshSeq = 0;
let loaded = false;
let oldestChecked: Promise<void> = Promise.resolve();

let unlistenStats: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

export function teardown() {
  // Invalidate in-flight refreshes so they cannot repaint the header of the next route.
  refreshSeq++;
  if (unlistenStats) { unlistenStats(); unlistenStats = null; }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

async function loadOldestEventMs(): Promise<number | null> {
  const farPast = Date.now() - 366 * 86_400_000;
  try {
    const events = await invoke("get_stats_range", { startMs: farPast, endMs: Date.now() });
    if (events.length === 0) return null;
    return Math.min(...events.map((e: any) => e.start_ms));
  } catch {
    return null;
  }
}

function localDateStr(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// `new Date("YYYY-MM-DD")` is UTC midnight, which lands on the previous local
// day west of UTC; build the local date from its parts instead.
function parseLocalDate(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function clampDay(day: number, today: number): number {
  return Math.min(Math.max(day, earliestDayStart), today);
}

function goToDay(day: number, els: Els, renderHeader: RenderHeaderFn): void {
  setSelectedDay(clampDay(day, startOfDay(Date.now())));
  refresh(els, renderHeader);
}

function pageWeek(dir: -1 | 1, els: Els, renderHeader: RenderHeaderFn): void {
  const today = startOfDay(Date.now());
  const selected = getSelectedDay();
  const win = weekWindow(selected, today, pagedEnd);
  const newEnd = Math.min(addDays(win.endDay, 7 * dir), today);
  if (newEnd === win.endDay || (dir < 0 && win.startDay <= earliestDayStart)) return;
  // Round absorbs the 23h/25h days around DST.
  const shiftDays = Math.round((newEnd - win.endDay) / 86_400_000);
  pagedEnd = newEnd === today ? null : newEnd;
  // Move the selection with the window so the rolling-window rule does not snap it back.
  goToDay(addDays(selected, shiftDays), els, renderHeader);
}

function paint(els: Els, events: any[], cap: number, now: number, renderHeader: RenderHeaderFn): void {
  const today = startOfDay(now);
  const day = getSelectedDay();
  const win = weekWindow(day, today, pagedEnd);
  const isToday = day === today;
  const dayEnd = addDays(day, 1);

  const dayEvents = events.filter((e) => e.start_ms < dayEnd && (e.end_ms ?? now) > day);
  // A past day is totalled as of its last instant so open/idle math cannot spill into today.
  const totals = todayTotals(dayEvents, isToday ? now : dayEnd - 1, cap);
  const firstStartMs = dayEvents.length > 0 ? Math.max(day, Math.min(...dayEvents.map((e) => e.start_ms))) : null;
  const rows = sessionRows(dayEvents, day, now);
  const model = stripModel(dayEvents, day, now, cap);
  const longLabel = fmtDayShort(day);

  renderDateRow(els.date, {
    selectedDay: day,
    isToday,
    canPrev: day > earliestDayStart,
    canNext: day < today,
    minDate: localDateStr(earliestDayStart),
    maxDate: localDateStr(today),
    value: localDateStr(day),
    // Reads the live selection: two fast clicks land before the repaint.
    onStep: (dir) => goToDay(addDays(getSelectedDay(), dir), els, renderHeader),
    onPick: (v) => goToDay(parseLocalDate(v), els, renderHeader),
  });

  renderWeekChart(els.week, {
    days: weekFocus(events, win.startDay, now),
    selectedDay: day,
    empty: loaded && !hasAnyEvents,
    canPrev: win.startDay > earliestDayStart,
    canNext: win.endDay < today,
    onSelect: (d) => goToDay(d, els, renderHeader),
    onPage: (dir) => pageWeek(dir, els, renderHeader),
  });

  renderHero(els.hero, heroModel(totals, isToday, longLabel, firstStartMs));
  renderTiles(els.tiles, totals, cap);
  // Before the first fetch the card stays blank rather than flashing "nothing tracked".
  renderRhythm(els.rhythm, {
    model: loaded ? model : null,
    focusMs: totals.work_ms,
    emptyTitle: loaded ? (hasAnyEvents ? `Nothing tracked on ${longLabel}` : "Nothing tracked yet") : "",
    hidden: !loaded,
  });
  renderLatestSessions(els.latest, rows, () => { location.hash = "#sessions"; });
  renderHeader();
}

async function refresh(els: Els, renderHeader: RenderHeaderFn): Promise<void> {
  const seq = ++refreshSeq;
  await oldestChecked;
  if (seq !== refreshSeq) return;
  const now = Date.now();
  const settings = await invoke("get_settings").catch(() => ({})) as any;
  const cap: number = settings?.idle_gap_cap_minutes ?? DEFAULT_IDLE_CAP_MIN;

  const today = startOfDay(now);
  const win = weekWindow(getSelectedDay(), today, pagedEnd);
  pagedEnd = win.endDay === today ? null : win.endDay;
  const events = await getRange(win.startDay, addDays(win.endDay, 1));
  if (seq !== refreshSeq) return;

  loaded = true;
  if (events.length > 0) {
    hasAnyEvents = true;
    earliestDayStart = Math.min(earliestDayStart, startOfDay(Math.min(...events.map((e) => e.start_ms))));
  }
  paint(els, events, cap, now, renderHeader);
}

export function mountDashboard(
  root: HTMLElement,
  renderHeader: RenderHeaderFn,
): void {
  teardown();
  loaded = false;
  hasAnyEvents = false;
  pagedEnd = null;
  earliestDayStart = startOfDay(Date.now());

  root.innerHTML = `
    <div class="dashboard" style="${phaseVarsStyle()}">
      <div id="dash-date"></div>
      <div id="dash-week"></div>
      <div id="dash-hero"></div>
      <div id="dash-tiles"></div>
      <div id="dash-rhythm"></div>
      <div id="dash-latest"></div>
    </div>
  `;

  const els: Els = {
    date: root.querySelector("#dash-date"),
    week: root.querySelector("#dash-week"),
    hero: root.querySelector("#dash-hero"),
    tiles: root.querySelector("#dash-tiles"),
    rhythm: root.querySelector("#dash-rhythm"),
    latest: root.querySelector("#dash-latest"),
  };

  // Shell first (hero off at 0m), data fills it in place when it arrives.
  paint(els, [], DEFAULT_IDLE_CAP_MIN, Date.now(), renderHeader);

  // Every refresh waits for the history lookup, otherwise a stats-updated refresh
  // that wins the race would show the first-run copy to someone with older data.
  oldestChecked = loadOldestEventMs().then((oldest) => {
    if (oldest != null) {
      hasAnyEvents = true;
      earliestDayStart = startOfDay(oldest);
    }
  });
  oldestChecked.then(() => refresh(els, renderHeader));

  listen("stats-updated", () => { refresh(els, renderHeader); }).then((un) => { unlistenStats = un; });

  visibilityHandler = () => {
    if (document.visibilityState === "visible") refresh(els, renderHeader);
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}
