// @ts-nocheck
import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
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
import { openEvent, closeOpenEvent } from "./shared/stats";
import { setupVisibility } from "./views/timer/visibility";
import { setupWindowEvents } from "./views/timer/window-events";
import { MeetingPolicy } from "./views/timer/meeting-mode";
import { onMeetingChanged } from "../vendor/tauri_kit/frontend/meeting/subscribe";
import {
  PHASE_WORK,
  PHASE_SHORT,
  PHASE_LONG,
  PHASE_OTHER,
  TimerStateMachine,
} from "./views/timer/timer-state";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Fire-and-forget. Reads __kit_auto_update from settings to decide behavior.
// Skip in dev: the dev binary lags the released version, so check() would
// always "find" an update and nag. import.meta.env.DEV is true only under vite dev.
if (!import.meta.env.DEV) runAutoUpdateCheck();

let settings = null;
let meetingPolicy = null;
// Signal must stay clear this long before a meeting counts as ended. Safe to keep
// short: meeting apps (incl. Google Meet) hold the mic while muted, so the signal
// only drops when you actually leave - not when you mute or turn the camera off.
const MEETING_GRACE_MS = 20000;

const STATE_KEY = "pomodoro-overlay-state";

const $ = (id) => document.getElementById(id);

function phaseDuration(p) {
  if (!settings) return 25 * 60;
  if (p === PHASE_SNOOZE) return SNOOZE_DURATION;
  if (p === PHASE_SHORT) return settings.short_break_minutes * 60;
  if (p === PHASE_LONG) return settings.long_break_minutes * 60;
  if (p === PHASE_OTHER) return 0; // stopwatch starts at 0 and counts up
  return settings.work_minutes * 60;
}

// Assigned by setupVisibility() during init(), before the first render().
let syncClickThrough = () => {};
let applyVisibility = () => {};

// The timer state machine owns all phase/timer state + the start/pause/skip/
// auto-advance logic; main.ts wires DOM + IPC side effects into it.
const sm = new TimerStateMachine({
  invoke,
  getSettings: () => settings,
  phaseDuration,
  openEvent,
  closeOpenEvent,
  playSound,
  fsState,
  enterOverlayFullscreen,
  exitOverlayFullscreen,
  renderSnoozeButton,
  getMeetingPolicy: () => meetingPolicy,
  render: () => render(),
  applyPhaseClass: () => applyPhaseClass(),
  syncClickThrough: () => syncClickThrough(),
});

function saveState() {
  if (sm.phase === PHASE_SNOOZE) return;
  localStorage.setItem(STATE_KEY, JSON.stringify({
    phase: sm.phase,
    remainingSec: sm.remainingSec,
    running: sm.running,
    workSessionsCompleted: sm.workSessionsCompleted,
    savedAt: Date.now(),
  }));
}

function loadState() {
  if (settings?.reset_on_restart) return false;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw);
    sm.phase = s.phase ?? sm.phase;
    if (sm.phase === PHASE_SNOOZE) { sm.phase = PHASE_WORK; return false; }
    sm.workSessionsCompleted = s.workSessionsCompleted ?? 0;
    const elapsed = s.running ? Math.floor((Date.now() - s.savedAt) / 1000) : 0;
    if (sm.phase === PHASE_OTHER) {
      // Stopwatch: stored remainingSec holds elapsed seconds; add wall-time elapsed.
      sm.remainingSec = Math.max(0, (s.remainingSec ?? 0) + elapsed);
      return !!s.running;
    }
    sm.remainingSec = Math.max(0, (s.remainingSec ?? phaseDuration(sm.phase)) - elapsed);
    if (sm.remainingSec <= 10) {
      sm.remainingSec = phaseDuration(sm.phase);
      return false;
    }
    return !!s.running && sm.remainingSec > 0;
  } catch (e) {
    console.warn("loadState failed", e);
    return false;
  }
}

function applyPhaseClass() {
  const c = $("app");
  c.classList.remove("phase-work", "phase-short", "phase-long", "phase-snooze", "phase-other");
  c.classList.add(`phase-${sm.phase}`);
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.phase === sm.phase);
  });
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m}:${ss}` : `${m}:${ss}`;
}

function timerIsEditable() {
  return !!(settings?.editable_when_paused && !sm.running && sm.phase !== PHASE_SNOOZE);
}

function render() {
  const timerEl = document.querySelector(".timer");
  if (!isEditMode()) {
    timerEl.textContent = fmt(sm.remainingSec);
  }
  timerEl.classList.toggle("timer-editable", timerIsEditable() && !isEditMode());
  $("play").textContent = sm.running ? "PAUSE" : "START";
  $("skip").classList.toggle("visible", sm.running);
  $("app").classList.toggle("is-paused", !sm.running);
  renderSnoozeButton();
  applyVisibility();
  saveState();
}

function exitEditMode(confirm) {
  exitEditModeImpl(confirm, (v) => { sm.remainingSec = v; }, render);
}

function addButtonSounds(btn) {
  btn.addEventListener("mouseenter", playHoverSound);
  btn.addEventListener("mousedown", playPressSound);
  btn.addEventListener("mouseup", playReleaseSound);
}

function setupControls() {
  $("play").addEventListener("click", () =>
    sm.running ? sm.pause() : sm.start().catch(() => {}),
  );
  $("skip").addEventListener("click", () => sm.endPhase().catch(() => {}));
  $("snooze").addEventListener("click", () => {
    if (settings?.pause_music_on_break !== "never" && sm.musicPausedByApp) {
      invoke("media_resume").catch(() => {});
      sm.musicPausedByApp = false;
    }
    startSnooze();
  });
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => sm.switchPhase(b.dataset.phase));
  });
  [$("play"), $("skip"), $("snooze"), ...document.querySelectorAll(".tab-btn")].forEach(addButtonSounds);
  setupResizeHandles();
  setupTimerEdit({
    timerIsEditable,
    getRemainingSec: () => sm.remainingSec,
    setRemainingSec: (v) => { sm.remainingSec = v; },
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
      document.body.classList.remove("is-fullscreen");
      invoke("disable_keep_awake").catch(() => {});
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
  sm.remainingSec = phaseDuration(sm.phase);
  const shouldResume = loadState();
  ({ syncClickThrough, applyVisibility } = setupVisibility({
    getSettings: () => settings,
    getRunning: () => sm.running,
    getPhase: () => sm.phase,
  }));
  initFullscreen({
    getSettings: () => settings,
    getPhase: () => sm.phase,
    setPhase: (p) => { sm.phase = p; },
    setRemainingSec: (v) => { sm.remainingSec = v; },
    getPhaseDuration: phaseDuration,
    fmt,
    applyPhaseClass,
    startTimer: () => sm.start(),
    render,
    refreshClickThrough: () => {
      applyVisibility();
      syncClickThrough();
    },
  });
  applyPhaseClass();
  render();
  if (shouldResume) sm.start();
  setupControls();
  meetingPolicy = new MeetingPolicy({
    isEnabled: () => !!settings?.meeting_detection_enabled,
    graceMs: () => MEETING_GRACE_MS,
    onEnter: () => {
      if (fsState.isOverlayFullscreen) exitOverlayFullscreen();
      sm.switchPhase(PHASE_OTHER);
      if (!sm.running) sm.start().catch(() => {});
    },
    onExit: async () => {
      // Meeting ended (grace) or hotkey-off: apply the configured end action.
      const action = settings?.meeting_end_action ?? "break";
      if (action === "nothing") return; // keep counting in Other
      sm.pause("switch");
      if (action === "break") {
        sm.switchPhase(PHASE_SHORT);
        if (settings?.meeting_break_fullscreen) await enterOverlayFullscreen();
        sm.start().catch(() => {});
      } else {
        sm.switchPhase(PHASE_WORK); // "focus"
      }
    },
  });
  await onMeetingChanged((s) => meetingPolicy.onRaw(s.active));
  await listen("hotkey-meeting-toggle", () => meetingPolicy.forceToggle());
  // Push service dropped the phone subscription; settings UI will surface a re-pair
  // banner in a later task. Wire the listener now so the event has a handler.
  listen("push-subscription-gone", () => {
    console.warn("phone unpaired by push service; re-pair needed");
  });
  // Drive the wall-clock grace auto-revert (throttle/sleep-proof).
  setInterval(() => meetingPolicy?.tick(), 2000);
  await setupReturnToCorner(() => settings);
  await setupWindowEvents({
    getRunning: () => sm.running,
    pause: (endedBy) => sm.pause(endedBy),
    start: () => sm.start(),
    skipPhase: () => sm.endPhase(),
    getSettings: () => settings,
    setSettings: (s) => { settings = s; },
    getPhase: () => sm.phase,
    setPhase: (p) => { sm.phase = p; },
    setRemainingSec: (v) => { sm.remainingSec = v; },
    setWorkSessionsCompleted: (v) => { sm.workSessionsCompleted = v; },
    getMusicPausedByApp: () => sm.musicPausedByApp,
    setMusicPausedByApp: (v) => { sm.musicPausedByApp = v; },
    getDndEnabledByApp: () => sm.dndEnabledByApp,
    setDndEnabledByApp: (v) => { sm.dndEnabledByApp = v; },
    syncClickThrough,
    render,
    applyPhaseClass,
    exitEditMode,
    phaseDuration,
  });
}

init();
