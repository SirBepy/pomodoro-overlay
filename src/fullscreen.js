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
  if (showSnooze) {
    btn.textContent = "2 more minutes";
  }
}

export async function enterOverlayFullscreen() {
  fsState.isOverlayFullscreen = true;
  await invoke("set_window_fullscreen", { fullscreen: true }).catch(() => {});
  renderSnoozeButton();
}

export async function exitOverlayFullscreen() {
  fsState.isOverlayFullscreen = false;
  await invoke("set_window_fullscreen", { fullscreen: false }).catch(() => {});
  renderSnoozeButton();
}

export function startSnooze() {
  fsState.pendingBreakPhase = _host.getPhase();
  _host.setPhase(PHASE_SNOOZE);
  _host.setRemainingSec(SNOOZE_DURATION);
  _host.applyPhaseClass();
  exitOverlayFullscreen();
  renderSnoozeButton();
  _host.render();
  _host.startTimer();
}
