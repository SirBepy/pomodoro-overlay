// @ts-nocheck
import { runAutoUpdateCheck } from "../vendor/tauri_kit/frontend/updater/auto-check";
import { initSounds, playHoverSound, playPressSound, playReleaseSound, playSound } from "./shared/sounds";
import {
  PHASE_SNOOZE,
  SNOOZE_DURATION,
  fsState,
  initFullscreen,
  renderSnoozeButton,
  enterOverlayFullscreen,
  exitOverlayFullscreen,
  startSnooze,
} from "./shared/fullscreen";
import {
  setupReturnToCorner,
  clearReturnCornerTimer,
  getReturnCornerTimer,
} from "./views/timer/return-to-corner";
import {
  isEditMode,
  exitEditMode as exitEditModeImpl,
  setupTimerEdit,
} from "./views/timer/timer-edit";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Fire-and-forget. Reads __kit_auto_update from settings to decide behavior.
runAutoUpdateCheck();

const PHASE_WORK = "work";
const PHASE_SHORT = "short";
const PHASE_LONG = "long";

let settings = null;
let phase = PHASE_WORK;
let remainingSec = 25 * 60;
let running = false;
let tickHandle = null;
let workSessionsCompleted = 0;
let musicPausedByApp = false;
let dndEnabledByApp = false;

const STATE_KEY = "pomodoro-overlay-state";

function saveState() {
  if (phase === PHASE_SNOOZE) return;
  localStorage.setItem(STATE_KEY, JSON.stringify({
    phase, remainingSec, running, workSessionsCompleted,
    savedAt: Date.now(),
  }));
}

function loadState() {
  if (settings?.reset_on_restart) return false;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    phase = s.phase ?? phase;
    if (phase === PHASE_SNOOZE) { phase = PHASE_WORK; return false; }
    workSessionsCompleted = s.workSessionsCompleted ?? 0;
    const elapsed = s.running ? Math.floor((Date.now() - s.savedAt) / 1000) : 0;
    remainingSec = Math.max(0, (s.remainingSec ?? phaseDuration(phase)) - elapsed);
    return !!s.running && remainingSec > 0;
  } catch (e) {
    console.warn("loadState failed", e);
    return false;
  }
}

const $ = (id) => document.getElementById(id);

function phaseDuration(p) {
  if (!settings) return 25 * 60;
  if (p === PHASE_SNOOZE) return SNOOZE_DURATION;
  if (p === PHASE_SHORT) return settings.short_break_minutes * 60;
  if (p === PHASE_LONG) return settings.long_break_minutes * 60;
  return settings.work_minutes * 60;
}

function applyPhaseClass() {
  const c = $("app");
  c.classList.remove("phase-work", "phase-short", "phase-long", "phase-snooze");
  c.classList.add(`phase-${phase}`);
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.phase === phase);
  });
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${m}:${ss}`;
}

function timerIsEditable() {
  return !!(settings?.editable_when_paused && !running && phase !== PHASE_SNOOZE);
}

let isHovered = false;

function applyVisibility() {
  if (!settings) return;
  const fadeWhen = settings.fade_when ?? "always";
  const shouldFade =
    fadeWhen === "always" || (fadeWhen === "running" && running);
  document.body.style.opacity =
    isHovered || !shouldFade ? "1" : String(settings.idle_opacity ?? 0.5);
  $("app").classList.toggle("is-hovered", isHovered || (!running && phase !== PHASE_SNOOZE));
}

function setupHoverOpacity() {
  setInterval(async () => {
    try {
      const over = await invoke("is_cursor_over_window");
      if (over !== isHovered) {
        isHovered = over;
        applyVisibility();
      }
    } catch (e) {
      console.warn("is_cursor_over_window failed", e);
    }
  }, 150);
}

function render() {
  const timerEl = document.querySelector(".timer");
  if (!isEditMode()) {
    timerEl.textContent = fmt(remainingSec);
  }
  timerEl.classList.toggle("timer-editable", timerIsEditable() && !isEditMode());
  $("play").textContent = running ? "PAUSE" : "START";
  $("skip").classList.toggle("visible", running);
  renderSnoozeButton();
  applyVisibility();
  saveState();
}

function exitEditMode(confirm) {
  exitEditModeImpl(confirm, (v) => { remainingSec = v; }, render);
}

function tick() {
  remainingSec -= 1;
  if (remainingSec <= 0) {
    handlePhaseEnd(true).catch((e) => console.warn("handlePhaseEnd error", e));
    return;
  }
  render();
}

async function startTimer() {
  if (running) return;
  if (phase === PHASE_WORK && fsState.isOverlayFullscreen) {
    exitOverlayFullscreen();
  }
  if (settings?.pause_music_on_break) {
    if (phase === PHASE_WORK && musicPausedByApp) {
      invoke("media_resume").catch(() => {});
      musicPausedByApp = false;
    } else if ((phase === PHASE_SHORT || phase === PHASE_LONG) && !musicPausedByApp) {
      const paused = await invoke("media_pause_if_playing").catch(() => false);
      if (paused) musicPausedByApp = true;
    }
  }
  if (settings?.dnd_on_focus && phase === PHASE_WORK && !dndEnabledByApp) {
    invoke("enable_dnd").catch(() => {});
    dndEnabledByApp = true;
  }
  running = true;
  tickHandle = setInterval(tick, 1000);
  render();
}

function pauseTimer() {
  running = false;
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
  if (dndEnabledByApp) {
    invoke("disable_dnd").catch(() => {});
    dndEnabledByApp = false;
  }
  render();
}

function setPhase(p) {
  // Snooze is cancelled when user manually switches phase
  if (fsState.snoozeHandle) {
    clearInterval(fsState.snoozeHandle);
    fsState.snoozeHandle = null;
    fsState.pendingBreakPhase = null;
  }
  pauseTimer();
  // Exiting to focus via tab click: restore original window size
  if (p === PHASE_WORK && fsState.isOverlayFullscreen) {
    exitOverlayFullscreen();
  }
  phase = p;
  remainingSec = phaseDuration(phase);
  applyPhaseClass();
  render();
}

async function handlePhaseEnd(natural = false) {
  pauseTimer();
  if (natural) playSound().catch(() => {});
  const ended = phase;

  if (ended === PHASE_SNOOZE) {
    const next = fsState.pendingBreakPhase ?? PHASE_SHORT;
    fsState.pendingBreakPhase = null;
    setPhaseInternal(next);
    invoke("show_main_window").catch(() => {});
    await enterOverlayFullscreen();
    renderSnoozeButton();
    if (settings.auto_start_break) await startTimer();
    return;
  }

  let next;
  if (ended === PHASE_WORK) {
    workSessionsCompleted += 1;
    const isLong =
      workSessionsCompleted % settings.sessions_before_long_break === 0;
    next = isLong ? PHASE_LONG : PHASE_SHORT;
  } else {
    next = PHASE_WORK;
  }
  setPhaseInternal(next);
  invoke("show_main_window").catch(() => {});

  if (ended === PHASE_WORK && settings.fullscreen_on_focus_end) {
    await enterOverlayFullscreen();
    if (settings.auto_start_break) await startTimer();
  } else {
    if (ended !== PHASE_WORK && fsState.isOverlayFullscreen) {
      await exitOverlayFullscreen();
    }
    const shouldAutoStart =
      next === PHASE_WORK ? settings.auto_start_work : settings.auto_start_break;
    if (shouldAutoStart) await startTimer();
  }
}

// Internal phase switch without fullscreen/snooze side effects
function setPhaseInternal(p) {
  pauseTimer();
  phase = p;
  remainingSec = phaseDuration(phase);
  applyPhaseClass();
  render();
}

function addButtonSounds(btn) {
  btn.addEventListener("mouseenter", playHoverSound);
  btn.addEventListener("mousedown", playPressSound);
  btn.addEventListener("mouseup", playReleaseSound);
}

function setupControls() {
  $("play").addEventListener("click", () =>
    running ? pauseTimer() : startTimer().catch(() => {}),
  );
  $("skip").addEventListener("click", () => handlePhaseEnd().catch(() => {}));
  $("snooze").addEventListener("click", () => startSnooze());
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => setPhase(b.dataset.phase));
  });
  [$("play"), $("skip"), $("snooze"), ...document.querySelectorAll(".tab-btn")].forEach(addButtonSounds);
  setupHoverOpacity();
  setupResizeHandles();
  setupTimerEdit({
    timerIsEditable,
    getRemainingSec: () => remainingSec,
    setRemainingSec: (v) => { remainingSec = v; },
    render,
  });
}

let resizeSaveTimer = null;

function setupResizeHandles() {
  document.querySelectorAll(".resize-handle").forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // User took manual control; exit fullscreen tracking
      fsState.isOverlayFullscreen = false;
      renderSnoozeButton();
      invoke("start_resize", { direction: el.dataset.dir }).catch((err) =>
        console.warn("start_resize failed", err),
      );
    });
  });
  window.addEventListener("resize", () => {
    // Don't save size while in fullscreen mode (size was set by the system)
    if (fsState.isOverlayFullscreen) return;
    if (resizeSaveTimer) clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(() => {
      resizeSaveTimer = null;
      invoke("save_window_size").catch((err) =>
        console.warn("save_window_size failed", err),
      );
    }, 400);
  });
}

async function init() {
  settings = await invoke("get_settings");
  initSounds(() => settings);
  remainingSec = phaseDuration(phase);
  const shouldResume = loadState();
  initFullscreen({
    getSettings: () => settings,
    getPhase: () => phase,
    setPhase: (p) => { phase = p; },
    setRemainingSec: (v) => { remainingSec = v; },
    getPhaseDuration: phaseDuration,
    fmt,
    applyPhaseClass,
    startTimer,
    render,
  });
  applyPhaseClass();
  render();
  if (shouldResume) startTimer();
  setupControls();
  await setupReturnToCorner(() => settings);
  await listen("settings-updated", async () => {
    if (isEditMode()) exitEditMode(true);
    const wasRunning = running;
    settings = await invoke("get_settings");
    if (!wasRunning) remainingSec = phaseDuration(phase);
    if (settings.return_to_corner_seconds === 0 && getReturnCornerTimer()) {
      clearReturnCornerTimer();
    }
    renderSnoozeButton();
    render();
  });
  await listen("settings-reset", async () => {
    pauseTimer();
    if (fsState.snoozeHandle) { clearInterval(fsState.snoozeHandle); fsState.snoozeHandle = null; }
    settings = await invoke("get_settings");
    phase = PHASE_WORK;
    remainingSec = phaseDuration(phase);
    workSessionsCompleted = 0;
    musicPausedByApp = false;
    if (dndEnabledByApp) {
      invoke("disable_dnd").catch(() => {});
      dndEnabledByApp = false;
    }
    fsState.pendingBreakPhase = null;
    fsState.isOverlayFullscreen = false;
    clearReturnCornerTimer();
    try {
      await invoke("set_window_size", { expanded: true });
    } catch (e) {
      console.warn("set_window_size failed", e);
    }
    applyPhaseClass();
    renderSnoozeButton();
    render();
  });
}

init();
