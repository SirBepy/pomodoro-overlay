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

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Fire-and-forget. Reads __kit_auto_update from settings to decide behavior.
// Skip in dev: the dev binary lags the released version, so check() would
// always "find" an update and nag. import.meta.env.DEV is true only under vite dev.
if (!import.meta.env.DEV) runAutoUpdateCheck();

const PHASE_WORK = "work";
const PHASE_SHORT = "short";
const PHASE_LONG = "long";
const PHASE_OTHER = "other";

let settings = null;
let phase = PHASE_WORK;
let remainingSec = 25 * 60;
let running = false;
let tickHandle = null;
let workSessionsCompleted = 0;
let musicPausedByApp = false;
let dndEnabledByApp = false;
let intervalStartMs = 0;        // wall-clock when current run-interval began
let intervalStartRemainingSec = 0; // remainingSec snapshot at that moment
let meetingPolicy = null;
// Signal must stay clear this long before a meeting counts as ended. Safe to keep
// short: meeting apps (incl. Google Meet) hold the mic while muted, so the signal
// only drops when you actually leave - not when you mute or turn the camera off.
const MEETING_GRACE_MS = 20000;

const STATE_KEY = "pomodoro-overlay-state";

// Fire-and-forget push of current timer state to the Rust backend, which decides
// (enabled + paired + per-phase toggles) whether to forward it to the paired phone.
// Must never block or throw into the timer path.
function pushState(event, endedPhase) {
  const nowMs = Date.now();
  const etaEpochMs = running && remainingSec > 0 ? nowMs + remainingSec * 1000 : 0;
  const payload = {
    phase,
    running,
    etaEpochMs,
    remainingSec,
    event,
    endedPhase,
    updatedAtMs: nowMs,
    workSessionsCompleted,
  };
  invoke("push_state", { payload }).catch((e) => console.warn("push_state failed", e));
}

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
    if (phase === PHASE_OTHER) {
      // Stopwatch: stored remainingSec holds elapsed seconds; add wall-time elapsed.
      remainingSec = Math.max(0, (s.remainingSec ?? 0) + elapsed);
      return !!s.running;
    }
    remainingSec = Math.max(0, (s.remainingSec ?? phaseDuration(phase)) - elapsed);
    if (remainingSec <= 10) {
      remainingSec = phaseDuration(phase);
      return false;
    }
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
  if (p === PHASE_OTHER) return 0; // stopwatch starts at 0 and counts up
  return settings.work_minutes * 60;
}

function applyPhaseClass() {
  const c = $("app");
  c.classList.remove("phase-work", "phase-short", "phase-long", "phase-snooze", "phase-other");
  c.classList.add(`phase-${phase}`);
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.phase === phase);
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
  return !!(settings?.editable_when_paused && !running && phase !== PHASE_SNOOZE);
}

// Assigned by setupVisibility() during init(), before the first render().
let syncClickThrough = () => {};
let applyVisibility = () => {};

function render() {
  const timerEl = document.querySelector(".timer");
  if (!isEditMode()) {
    timerEl.textContent = fmt(remainingSec);
  }
  timerEl.classList.toggle("timer-editable", timerIsEditable() && !isEditMode());
  $("play").textContent = running ? "PAUSE" : "START";
  $("skip").classList.toggle("visible", running);
  $("app").classList.toggle("is-paused", !running);
  renderSnoozeButton();
  applyVisibility();
  saveState();
}

function exitEditMode(confirm) {
  exitEditModeImpl(confirm, (v) => { remainingSec = v; }, render);
}

function tick() {
  const elapsedSec = Math.floor((Date.now() - intervalStartMs) / 1000);
  if (phase === PHASE_OTHER) {
    remainingSec = intervalStartRemainingSec + elapsedSec; // stopwatch: count up
    render();
    return;
  }
  remainingSec = Math.max(0, intervalStartRemainingSec - elapsedSec);
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
  const pmob = settings?.pause_music_on_break;
  if (pmob === "on_break" || pmob === "not_running_focused") {
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
  // Stats: open event. If we're resuming after a pause (same phase still set),
  // share the existing session_id.
  const configured = phase === PHASE_OTHER ? null : phaseDuration(phase);
  await openEvent(phase, configured, /* resumeSession */ true);
  running = true;
  intervalStartMs = Date.now();
  intervalStartRemainingSec = remainingSec;
  tickHandle = setInterval(tick, 1000);
  syncClickThrough();
  render();
  pushState("start");
}

function pauseTimer(endedBy = "pause") {
  if (!running) {
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = null;
    return;
  }
  running = false;
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
  closeOpenEvent(endedBy).catch(() => {});
  if (dndEnabledByApp) {
    invoke("disable_dnd").catch(() => {});
    dndEnabledByApp = false;
  }
  if (settings?.pause_music_on_break === "not_running_focused" && phase === PHASE_WORK && !musicPausedByApp) {
    invoke("media_pause_if_playing").then((paused) => { if (paused) musicPausedByApp = true; }).catch(() => {});
  }
  syncClickThrough();
  render();
  pushState("pause");
}

// Manually leaving the Other phase (tab click, skip button, skip keybind) means
// "meeting's over": drop meeting-mode so sounds/fullscreen resume and the next
// meeting can re-trigger. The policy's own enter targets Other (skipped here)
// and its exit sets active=false first, so policy-driven changes never match.
function leaveMeetingIfActive(nextPhase) {
  if (meetingPolicy?.active && nextPhase !== PHASE_OTHER) {
    meetingPolicy.leaveMeetingPhase();
  }
}

function setPhase(p) {
  // Snooze is cancelled when user manually switches phase
  if (fsState.snoozeHandle) {
    clearInterval(fsState.snoozeHandle);
    fsState.snoozeHandle = null;
    fsState.pendingBreakPhase = null;
  }
  leaveMeetingIfActive(p);
  pauseTimer("switch");
  phase = p;
  remainingSec = phaseDuration(phase);
  applyPhaseClass();
  render();
}

async function handlePhaseEnd(natural = false) {
  if (running) {
    await closeOpenEvent(natural ? "natural" : "skip");
  }
  pauseTimer();
  if (natural && !meetingPolicy?.active) playSound().catch(() => {});
  const ended = phase;

  if (ended === PHASE_SNOOZE) {
    const next = fsState.pendingBreakPhase ?? PHASE_SHORT;
    fsState.pendingBreakPhase = null;
    setPhaseInternal(next);
    pushState(natural ? "phase-end" : "skip", ended);
    invoke("show_main_window").catch(() => {});
    await enterOverlayFullscreen();
    renderSnoozeButton();
    if (settings.auto_start_break) await startTimer();
    return;
  }

  if (ended === PHASE_OTHER) {
    // Stopwatch ended manually (skip). Just return to work; do not auto-start.
    setPhaseInternal(PHASE_WORK);
    pushState(natural ? "phase-end" : "skip", ended);
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
  pushState(natural ? "phase-end" : "skip", ended);
  invoke("show_main_window").catch(() => {});

  if (ended === PHASE_WORK && settings.fullscreen_on_focus_end && !meetingPolicy?.active) {
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
  leaveMeetingIfActive(p);
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
  $("snooze").addEventListener("click", () => {
    if (settings?.pause_music_on_break !== "never" && musicPausedByApp) {
      invoke("media_resume").catch(() => {});
      musicPausedByApp = false;
    }
    startSnooze();
  });
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => setPhase(b.dataset.phase));
  });
  [$("play"), $("skip"), $("snooze"), ...document.querySelectorAll(".tab-btn")].forEach(addButtonSounds);
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
  remainingSec = phaseDuration(phase);
  const shouldResume = loadState();
  ({ syncClickThrough, applyVisibility } = setupVisibility({
    getSettings: () => settings,
    getRunning: () => running,
    getPhase: () => phase,
  }));
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
    refreshClickThrough: () => {
      applyVisibility();
      syncClickThrough();
    },
  });
  applyPhaseClass();
  render();
  if (shouldResume) startTimer();
  setupControls();
  meetingPolicy = new MeetingPolicy({
    isEnabled: () => !!settings?.meeting_detection_enabled,
    graceMs: () => MEETING_GRACE_MS,
    onEnter: () => {
      if (fsState.isOverlayFullscreen) exitOverlayFullscreen();
      setPhase(PHASE_OTHER);
      if (!running) startTimer().catch(() => {});
    },
    onExit: async () => {
      // Meeting ended (grace) or hotkey-off: apply the configured end action.
      const action = settings?.meeting_end_action ?? "break";
      if (action === "nothing") return; // keep counting in Other
      pauseTimer("switch");
      if (action === "break") {
        setPhase(PHASE_SHORT);
        if (settings?.meeting_break_fullscreen) await enterOverlayFullscreen();
        startTimer().catch(() => {});
      } else {
        setPhase(PHASE_WORK); // "focus"
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
    getRunning: () => running,
    pause: pauseTimer,
    start: startTimer,
    skipPhase: () => handlePhaseEnd(),
    getSettings: () => settings,
    setSettings: (s) => { settings = s; },
    getPhase: () => phase,
    setPhase: (p) => { phase = p; },
    setRemainingSec: (v) => { remainingSec = v; },
    setWorkSessionsCompleted: (v) => { workSessionsCompleted = v; },
    getMusicPausedByApp: () => musicPausedByApp,
    setMusicPausedByApp: (v) => { musicPausedByApp = v; },
    getDndEnabledByApp: () => dndEnabledByApp,
    setDndEnabledByApp: (v) => { dndEnabledByApp = v; },
    syncClickThrough,
    render,
    applyPhaseClass,
    exitEditMode,
    phaseDuration,
  });
}

init();
