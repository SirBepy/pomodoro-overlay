const { invoke } = window.__TAURI__.core;

export const PHASE_SNOOZE = "snooze";
export const SNOOZE_DURATION = 2 * 60;

export const fsState = {
  isOverlayFullscreen: false,
  snoozeCount: 0,
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
    btn.textContent = `2 more minutes #${fsState.snoozeCount + 1}`;
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
  if (fsState.snoozeHandle) {
    clearInterval(fsState.snoozeHandle);
    fsState.snoozeHandle = null;
  }
  fsState.pendingBreakPhase = _host.getPhase();
  fsState.snoozeCount += 1;
  fsState.snoozeRemaining = SNOOZE_DURATION;
  _host.setPhase(PHASE_SNOOZE);
  _host.applyPhaseClass();
  renderSnoozeButton();
  fsState.snoozeHandle = setInterval(() => {
    fsState.snoozeRemaining -= 1;
    if (fsState.snoozeRemaining <= 0) {
      clearInterval(fsState.snoozeHandle);
      fsState.snoozeHandle = null;
      endSnooze();
    } else {
      document.querySelector(".timer").textContent = _host.fmt(fsState.snoozeRemaining);
    }
  }, 1000);
  document.querySelector(".timer").textContent = _host.fmt(fsState.snoozeRemaining);
}

export function endSnooze() {
  const nextPhase = fsState.pendingBreakPhase ?? "short";
  fsState.pendingBreakPhase = null;
  _host.setPhase(nextPhase);
  _host.setRemainingSec(_host.getPhaseDuration(nextPhase));
  _host.applyPhaseClass();
  renderSnoozeButton();
  _host.render();
  if (_host.getSettings()?.auto_start_break) _host.startTimer();
}
