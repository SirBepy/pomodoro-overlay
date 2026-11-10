import { PHASE_OTHER } from "../views/timer/timer-state";
import { formatTotalHM } from "../views/timer/elapsed-summary";

// The overlay is either the corner box or, with overlay_form "bar", an edge
// strip. Rust owns the window geometry; this restyles the one #app into the bar
// (body.is-bar + data-bar-layout, see base.css) and keeps its label current.
const BAR_CLASS = "is-bar";
// A bar move this soon after we placed it is the placement itself, not a drag.
const SELF_MOVE_QUIET_MS = 600;
const SNAP_POLL_MS = 120;

export const barState = {
  active: false,
  // What the current bar was placed with; a change re-places it.
  key: "",
};

/** Bar whenever the form says so; the fullscreen break owns the window meanwhile. */
export function wantsBar(
  settings: { overlay_form?: string } | null | undefined,
  fullscreen: boolean,
): boolean {
  return settings?.overlay_form === "bar" && !fullscreen;
}

/**
 * The bar never goes fullscreen: it just changes colour for a break. Every
 * fullscreen entry (focus end, meeting end, snooze return) goes through
 * enterOverlayFullscreen, which asks this.
 */
export function fullscreenAllowed(
  settings: { overlay_form?: string } | null | undefined,
): boolean {
  return settings?.overlay_form !== "bar";
}

export type BarLayout = "bar-h" | "bar-v";

/** Top/bottom bars lay out as a row, side bars as a column. */
export function barLayout(edge: string | undefined): BarLayout {
  return edge === "left" || edge === "right" ? "bar-v" : "bar-h";
}

/** Everything that, once changed, needs the window re-placed. */
export function barKey(
  s:
    | { bar_monitor?: string; bar_edge?: string; bar_size?: string; bar_thickness?: number }
    | null
    | undefined,
): string {
  return [s?.bar_monitor, s?.bar_edge, s?.bar_size, s?.bar_thickness].join("|");
}

/**
 * The text next to the time. Only the Stopwatch has anything to say (the day's
 * total); the phase colour already says focus vs break, so everything else is "".
 */
export function barLabel(phase: string, todayTotalMs: number): string {
  return phase === PHASE_OTHER ? `total ${formatTotalHM(todayTotalMs)}` : "";
}

interface OverlayBarHost {
  getSettings: () => any;
  getPhase: () => string;
  isFullscreen: () => boolean;
  /** Focus + stopwatch ms logged today, for the Stopwatch label. */
  getTodayTotalMs: () => number;
  /** Re-derives overlay opacity + click-through after the bar flips. */
  refreshClickThrough: () => void;
}

let _host: OverlayBarHost | null = null;
// Serializes the window commands so a quick on/off/on lands in order.
let chain: Promise<void> = Promise.resolve();
let ignoreMovesUntil = 0;
let snapPoll: ReturnType<typeof setInterval> | null = null;

export function initOverlayBar(host: OverlayBarHost) {
  _host = host;
}

/** Resolves false when Rust refused (e.g. no monitor), so callers skip the styling. */
function invokeBar(active: boolean): Promise<boolean> {
  ignoreMovesUntil = Date.now() + SELF_MOVE_QUIET_MS;
  return window.__TAURI__.core
    .invoke("set_overlay_bar", { active })
    .then(() => true)
    .catch((e: unknown) => {
      console.warn("set_overlay_bar failed", e);
      return false;
    })
    .finally(() => {
      ignoreMovesUntil = Date.now() + SELF_MOVE_QUIET_MS;
    });
}

function queue(op: () => Promise<void> | void) {
  chain = chain.then(op).catch((e) => console.warn("overlay bar op failed", e));
}

function renderLabel() {
  const el = document.querySelector(".bar-label");
  if (!el || !_host) return;
  const text = barLabel(_host.getPhase(), _host.getTodayTotalMs());
  if (el.textContent !== text) el.textContent = text;
}

function clearStyling() {
  document.body.classList.remove(BAR_CLASS);
  delete document.body.dataset.barLayout;
}

function placeBar(layout: BarLayout) {
  queue(async () => {
    // A newer evaluation already dropped the bar (e.g. fullscreen took over).
    if (!barState.active) return;
    if (!(await invokeBar(true))) {
      // A failed re-place can leave Rust's bar up; exit is a no-op when it is
      // not, so this always ends in the box. Forgetting the key lets the next
      // render retry.
      barState.active = false;
      barState.key = "";
      await invokeBar(false);
      clearStyling();
      _host?.refreshClickThrough();
      return;
    }
    // Styled only once the window has its new shape, so the box layout never
    // flashes stretched across a monitor.
    document.body.dataset.barLayout = layout;
    renderLabel();
    document.body.classList.add(BAR_CLASS);
    _host?.refreshClickThrough();
  });
}

function removeBar() {
  queue(async () => {
    // Re-enabled while this was queued: the pending place op wins.
    if (barState.active) return;
    await invokeBar(false);
    clearStyling();
    _host?.refreshClickThrough();
  });
}

/**
 * Re-derives the bar from the form setting and the fullscreen state. Called
 * wherever those can change (render), so it must be cheap and idempotent.
 */
export function evaluateBar() {
  if (!_host) return;
  const settings = _host.getSettings();
  const want = wantsBar(settings, _host.isFullscreen());
  const key = barKey(settings);

  if (want) {
    if (barState.active) renderLabel();
    if (!barState.active || barState.key !== key) {
      barState.active = true;
      barState.key = key;
      placeBar(barLayout(settings?.bar_edge));
    }
  } else if (barState.active) {
    barState.active = false;
    removeBar();
  }
}

/**
 * Called once fullscreen is entered. Rust moves the window straight from the bar
 * to fullscreen, so only the styling is left to clear here.
 */
export function settleBarAfterFullscreen() {
  barState.active = false;
  queue(clearStyling);
}

function startSnapPoll() {
  if (snapPoll) return;
  snapPoll = setInterval(async () => {
    const result = await window.__TAURI__.core
      .invoke("snap_overlay_bar")
      .catch(() => "idle");
    // Rust answers "dragging" until the mouse button is up.
    if (result === "dragging") return;
    clearInterval(snapPoll!);
    snapPoll = null;
    if (result === "snapped") ignoreMovesUntil = Date.now() + SELF_MOVE_QUIET_MS;
  }, SNAP_POLL_MS);
}

/**
 * Dragging the bar (the same drag region as the box) moves the OS window; on
 * release Rust snaps it to the nearest edge and saves that choice. The window has
 * no drag-end event, so a move starts a poll that Rust answers once the button is up.
 */
export async function setupBarDrag() {
  const win = window.__TAURI__.window.getCurrentWindow();
  await win.onMoved(() => {
    if (!barState.active || Date.now() < ignoreMovesUntil) return;
    startSnapPoll();
  });
}
