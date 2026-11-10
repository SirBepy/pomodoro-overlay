import { PHASE_WORK, PHASE_OTHER } from "../views/timer/timer-state";

// Pause shorter than this keeps the sign up, so a quick pause (or a tab switch
// that restarts the timer) does not flap the window on and off.
export const SIGN_PAUSE_GRACE_MS = 10_000;

const SIGN_CLASS = "is-focus-sign";
// A sign move this soon after we placed it is the placement itself, not a drag.
const SELF_MOVE_QUIET_MS = 600;
const SNAP_POLL_MS = 120;

export const signState = {
  active: false,
  // What the current sign was placed with; a change re-places it.
  key: "",
};

/**
 * Whether the "working, do not disturb" sign should be up. Pure so the policy
 * is testable without the window. `pausedMs` is how long the timer has been
 * paused (Infinity if it never ran this session).
 */
export function shouldShowSign(
  phase: string,
  running: boolean,
  fullscreen: boolean,
  settings: { focus_sign_enabled?: boolean } | null | undefined,
  pausedMs = 0,
): boolean {
  if (!settings?.focus_sign_enabled) return false;
  // Fullscreen always wins: the break view owns the window.
  if (fullscreen) return false;
  if (phase !== PHASE_WORK && phase !== PHASE_OTHER) return false;
  return running || pausedMs < SIGN_PAUSE_GRACE_MS;
}

export type SignLayout = "bar-h" | "bar-v" | "box";

/** Which content template the sign uses: top/bottom bars lay out as a row, side bars stack. */
export function signLayout(form: string | undefined, edge: string | undefined): SignLayout {
  if (form === "box") return "box";
  return edge === "left" || edge === "right" ? "bar-v" : "bar-h";
}

/** "H:MM": no seconds, so it changes once a minute. */
export function formatTotalHM(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  return `${h}:${(totalMin % 60).toString().padStart(2, "0")}`;
}

/** The quiet label next to the time: what the sign says is going on. */
export function signLabel(phase: string, todayTotalMs: number): string {
  return phase === PHASE_OTHER ? `total ${formatTotalHM(todayTotalMs)}` : "focusing";
}

export interface PauseTracker {
  wasRunning: boolean;
  /** null = no grace to honor (never ran, or ran outside a sign phase). */
  pausedSince: number | null;
}

/**
 * Starts the pause grace only when the timer was running in a phase the sign
 * covers. Otherwise a break ending into an idle Focus (auto-start off) would
 * show the sign for the grace on a timer that never started.
 */
export function advancePauseTracker(
  prev: PauseTracker,
  running: boolean,
  phase: string,
  now: number,
): PauseTracker {
  if (running) {
    return { wasRunning: phase === PHASE_WORK || phase === PHASE_OTHER, pausedSince: null };
  }
  // A pause seen in a break phase is a run that ended or was switched away
  // from, and any grace left over from an earlier pause dies with the phase.
  if (phase !== PHASE_WORK && phase !== PHASE_OTHER) {
    return { wasRunning: false, pausedSince: null };
  }
  if (prev.wasRunning) return { wasRunning: false, pausedSince: now };
  return prev;
}

interface FocusSignHost {
  getSettings: () => any;
  getPhase: () => string;
  getRunning: () => boolean;
  isFullscreen: () => boolean;
  /** Focus + stopwatch ms logged today, for the Stopwatch label. */
  getTodayTotalMs: () => number;
  /** Re-derives overlay opacity + click-through after the sign flips. */
  refreshClickThrough: () => void;
  now?: () => number;
}

let _host: FocusSignHost | null = null;
let tracker: PauseTracker = { wasRunning: false, pausedSince: null };
let graceTimer: ReturnType<typeof setTimeout> | null = null;
// Serializes the window commands so a quick on/off/on lands in order.
let chain: Promise<void> = Promise.resolve();
let ignoreMovesUntil = 0;
let snapPoll: ReturnType<typeof setInterval> | null = null;

export function initFocusSign(host: FocusSignHost) {
  _host = host;
}

/** Resolves false when Rust refused (e.g. no monitor), so callers skip the styling. */
function invokeSign(active: boolean): Promise<boolean> {
  ignoreMovesUntil = Date.now() + SELF_MOVE_QUIET_MS;
  return window.__TAURI__.core
    .invoke("set_focus_sign", { active })
    .then(() => true)
    .catch((e: unknown) => {
      console.warn("set_focus_sign failed", e);
      return false;
    })
    .finally(() => {
      ignoreMovesUntil = Date.now() + SELF_MOVE_QUIET_MS;
    });
}

function queue(op: () => Promise<void> | void) {
  chain = chain.then(op).catch((e) => console.warn("focus sign op failed", e));
}

function renderIcon(phase: string) {
  const icon = document.querySelector(".sign-icon");
  if (!icon) return;
  icon.className = `sign-icon ph-fill ${phase === PHASE_OTHER ? "ph-timer" : "ph-brain"}`;
}

function renderLabel(phase: string) {
  const el = document.querySelector(".sign-label");
  if (!el || !_host) return;
  const text = signLabel(phase, _host.getTodayTotalMs());
  if (el.textContent !== text) el.textContent = text;
}

function placeSign(phase: string, layout: SignLayout) {
  queue(async () => {
    // A newer evaluation already dropped the sign (e.g. fullscreen took over).
    if (!signState.active) return;
    if (!(await invokeSign(true))) {
      // A failed re-place can leave Rust's sign up; exit is a no-op when it is
      // not, so this always ends in the corner. Forgetting the key lets the next
      // render retry.
      signState.active = false;
      signState.key = "";
      await invokeSign(false);
      document.body.classList.remove(SIGN_CLASS);
      delete document.body.dataset.signLayout;
      _host?.refreshClickThrough();
      return;
    }
    // Styled only once the window has its new shape, so the old layout never
    // flashes stretched across a monitor.
    document.body.dataset.signLayout = layout;
    renderIcon(phase);
    renderLabel(phase);
    document.body.classList.add(SIGN_CLASS);
    _host?.refreshClickThrough();
  });
}

function removeSign() {
  queue(async () => {
    // Re-enabled while this was queued: the pending place op wins.
    if (signState.active) return;
    await invokeSign(false);
    document.body.classList.remove(SIGN_CLASS);
    delete document.body.dataset.signLayout;
    _host?.refreshClickThrough();
  });
}

/**
 * Re-derives the sign from phase, running state and settings. Called wherever
 * those can change (render), so it must be cheap and idempotent.
 */
export function evaluateSign() {
  if (!_host) return;
  const now = (_host.now ?? Date.now)();
  const settings = _host.getSettings();
  const running = _host.getRunning();
  const phase = _host.getPhase();

  tracker = advancePauseTracker(tracker, running, phase, now);
  const { pausedSince } = tracker;
  const pausedMs = running ? 0 : pausedSince === null ? Infinity : now - pausedSince;

  const want = shouldShowSign(phase, running, _host.isFullscreen(), settings, pausedMs);
  const key = [
    settings?.focus_sign_form,
    settings?.focus_sign_monitor,
    settings?.focus_sign_edge,
    settings?.focus_sign_corner,
    settings?.focus_sign_size,
  ].join("|");

  if (graceTimer) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
  // Nothing re-renders a paused timer, so the grace expiry needs its own wakeup.
  if (want && !running) {
    graceTimer = setTimeout(evaluateSign, SIGN_PAUSE_GRACE_MS - pausedMs + 50);
  }

  if (want) {
    if (signState.active) {
      renderIcon(phase);
      renderLabel(phase);
    }
    if (!signState.active || signState.key !== key) {
      signState.active = true;
      signState.key = key;
      placeSign(phase, signLayout(settings?.focus_sign_form, settings?.focus_sign_edge));
    }
  } else if (signState.active) {
    signState.active = false;
    removeSign();
  }
}

/**
 * Marks the sign gone without touching the window, for a focus-to-fullscreen
 * break: Rust moves the window straight from the sign to fullscreen, so
 * restoring the corner in between would flash it.
 */
export function handOffSignToFullscreen() {
  if (!signState.active) return;
  signState.active = false;
}

/** Called once fullscreen is entered: the sign's styling is no longer needed. */
export function settleSignAfterFullscreen() {
  signState.active = false;
  queue(() => {
    document.body.classList.remove(SIGN_CLASS);
    delete document.body.dataset.signLayout;
  });
}

function startSnapPoll() {
  if (snapPoll) return;
  snapPoll = setInterval(async () => {
    const result = await window.__TAURI__.core
      .invoke("snap_focus_sign")
      .catch(() => "idle");
    // Rust answers "dragging" until the mouse button is up.
    if (result === "dragging") return;
    clearInterval(snapPoll!);
    snapPoll = null;
    if (result === "snapped") ignoreMovesUntil = Date.now() + SELF_MOVE_QUIET_MS;
  }, SNAP_POLL_MS);
}

/**
 * Dragging the sign (possible only while the click-through modifier is held)
 * moves the OS window; on release Rust snaps it to the nearest edge/corner and
 * saves that choice. The window has no drag-end event, so a move starts a poll
 * that Rust answers once the button is up.
 */
export async function setupSignDrag() {
  const win = window.__TAURI__.window.getCurrentWindow();
  await win.onMoved(() => {
    if (!signState.active || Date.now() < ignoreMovesUntil) return;
    startSnapPoll();
  });
}
