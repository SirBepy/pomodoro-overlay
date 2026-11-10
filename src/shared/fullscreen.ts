const { invoke } = window.__TAURI__.core;

export const PHASE_SNOOZE = "snooze";
export const SNOOZE_DURATION = 2 * 60;

export const fsState = {
  isOverlayFullscreen: false,
  snoozeHandle: null,
  snoozeRemaining: 0,
  pendingBreakPhase: null,
};

let _host = null;

export function initFullscreen(host) {
  _host = host;
}

export function renderSnoozeButton() {
  const btn = document.getElementById("snooze");
  if (!btn) return;
  const settings = _host.getSettings();
  const phase = _host.getPhase();
  const showSnooze =
    settings?.fullscreen_on_focus_end &&
    fsState.isOverlayFullscreen &&
    (phase === "short" || phase === "long");
  btn.classList.toggle("visible", showSnooze);
}

export async function enterOverlayFullscreen() {
  fsState.isOverlayFullscreen = true;
  document.body.classList.add("is-fullscreen");
  // Rust leaves the sign inside set_window_fullscreen; this only clears its styling.
  _host?.onFullscreenEnter?.();
  await invoke("set_window_fullscreen", { fullscreen: true }).catch(() => {});
  if (_host?.getSettings()?.keep_awake_during_fullscreen) {
    invoke("enable_keep_awake").catch(() => {});
  }
  _host?.refreshClickThrough?.();
  renderSnoozeButton();
}

export async function exitOverlayFullscreen() {
  fsState.isOverlayFullscreen = false;
  document.body.classList.remove("is-fullscreen");
  await invoke("set_window_fullscreen", { fullscreen: false }).catch(() => {});
  invoke("disable_keep_awake").catch(() => {});
  _host?.refreshClickThrough?.();
  renderSnoozeButton();
}

export function startSnooze() {
  const phase = _host.getPhase();
  // Stop the running interval first - its anchor (intervalStartRemainingSec) is
  // still tied to the phase we're leaving, so the next tick would recompute
  // remainingSec from that stale anchor and clobber the fresh SNOOZE_DURATION
  // set below. Re-snoozing while already snoozing hits this too: pauseTimer()
  // clears the old anchor, then startTimer() re-anchors from SNOOZE_DURATION.
  _host.pauseTimer();
  if (phase !== PHASE_SNOOZE) {
    fsState.pendingBreakPhase = phase;
  }
  _host.setPhase(PHASE_SNOOZE);
  _host.setRemainingSec(SNOOZE_DURATION);
  _host.applyPhaseClass();
  exitOverlayFullscreen();
  renderSnoozeButton();
  _host.render();
  _host.startTimer();
}
