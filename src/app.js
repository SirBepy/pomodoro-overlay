import { runAutoUpdateCheck } from "../vendor/tauri_kit/frontend/updater/auto-check";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

// Fire-and-forget. Reads __kit_auto_update from settings to decide behavior.
runAutoUpdateCheck();

const PHASE_WORK = "work";
const PHASE_SHORT = "short";
const PHASE_LONG = "long";
const PHASE_SNOOZE = "snooze";
const SNOOZE_DURATION = 2 * 60;

let settings = null;
let phase = PHASE_WORK;
let remainingSec = 25 * 60;
let running = false;
let tickHandle = null;
let workSessionsCompleted = 0;
let counter = 1;

// Fullscreen / snooze state
let isOverlayFullscreen = false;
let snoozeCount = 0;
let snoozeHandle = null;
let snoozeRemaining = 0;
let pendingBreakPhase = null;

const STATE_KEY = "pomodoro-overlay-state";

function saveState() {
  if (phase === PHASE_SNOOZE) return;
  localStorage.setItem(STATE_KEY, JSON.stringify({
    phase, remainingSec, running, workSessionsCompleted, counter,
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
    counter = s.counter ?? 1;
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

let isHovered = false;

function applyVisibility() {
  if (!settings) return;
  const fadeWhen = settings.fade_when ?? "always";
  const shouldFade =
    fadeWhen === "always" || (fadeWhen === "running" && running);
  document.body.style.opacity =
    isHovered || !shouldFade ? "1" : String(settings.idle_opacity ?? 0.5);
  $("app").classList.toggle("is-hovered", isHovered || !running);
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

function renderSnoozeButton() {
  const btn = $("snooze");
  if (!btn) return;
  const showSnooze =
    settings?.fullscreen_on_focus_end &&
    isOverlayFullscreen &&
    (phase === PHASE_SHORT || phase === PHASE_LONG);
  btn.classList.toggle("visible", showSnooze);
  if (showSnooze) {
    btn.textContent = `2 more minutes #${snoozeCount + 1}`;
  }
}

function render() {
  const t = phase === PHASE_SNOOZE ? fmt(snoozeRemaining) : fmt(remainingSec);
  document.querySelector(".timer").textContent = t;
  $("play").textContent = `${running ? "PAUSE" : "START"} #${counter}`;
  $("skip").classList.toggle("visible", running && phase !== PHASE_SNOOZE);
  renderSnoozeButton();
  applyVisibility();
  saveState();
}

function tick() {
  remainingSec -= 1;
  if (remainingSec <= 0) {
    handlePhaseEnd();
    return;
  }
  render();
}

function startTimer() {
  if (running) return;
  // Exiting to focus: restore original window size
  if (phase === PHASE_WORK && isOverlayFullscreen) {
    exitOverlayFullscreen();
  }
  running = true;
  tickHandle = setInterval(tick, 1000);
  render();
}

function pauseTimer() {
  running = false;
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
  render();
}

function setPhase(p) {
  // Snooze is cancelled when user manually switches phase
  if (snoozeHandle) {
    clearInterval(snoozeHandle);
    snoozeHandle = null;
    pendingBreakPhase = null;
  }
  pauseTimer();
  // Exiting to focus via tab click: restore original window size
  if (p === PHASE_WORK && isOverlayFullscreen) {
    exitOverlayFullscreen();
  }
  phase = p;
  remainingSec = phaseDuration(phase);
  applyPhaseClass();
  render();
}

// ── Fullscreen overlay ──

async function enterOverlayFullscreen() {
  isOverlayFullscreen = true;
  await invoke("set_window_fullscreen", { fullscreen: true }).catch(() => {});
  renderSnoozeButton();
}

async function exitOverlayFullscreen() {
  isOverlayFullscreen = false;
  await invoke("set_window_fullscreen", { fullscreen: false }).catch(() => {});
  renderSnoozeButton();
}

// ── Snooze (2 more minutes) ──

function startSnooze() {
  if (snoozeHandle) {
    clearInterval(snoozeHandle);
    snoozeHandle = null;
  }
  pendingBreakPhase = phase;
  snoozeCount += 1;
  snoozeRemaining = SNOOZE_DURATION;
  phase = PHASE_SNOOZE;
  applyPhaseClass();
  renderSnoozeButton();
  snoozeHandle = setInterval(() => {
    snoozeRemaining -= 1;
    if (snoozeRemaining <= 0) {
      clearInterval(snoozeHandle);
      snoozeHandle = null;
      endSnooze();
    } else {
      document.querySelector(".timer").textContent = fmt(snoozeRemaining);
    }
  }, 1000);
  document.querySelector(".timer").textContent = fmt(snoozeRemaining);
}

function endSnooze() {
  phase = pendingBreakPhase ?? PHASE_SHORT;
  pendingBreakPhase = null;
  remainingSec = phaseDuration(phase);
  applyPhaseClass();
  // Stay fullscreen during break after snooze
  renderSnoozeButton();
  render();
  if (settings?.auto_start_break) startTimer();
}

let audioCtx = null;
function synthBeep(volume) {
  try {
    audioCtx =
      audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    const playTone = (freq, startOffset, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t0 = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
      gain.gain.linearRampToValueAtTime(volume * 0.6, t0 + dur * 0.6);
      gain.gain.linearRampToValueAtTime(0, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    };
    playTone(880, 0, 0.18);
    playTone(1175, 0.18, 0.32);
  } catch (e) {
    console.warn("synthBeep failed", e);
  }
}

async function playSound() {
  if (!settings.sound_enabled) return;
  if (settings.sound_path) {
    try {
      const url = window.__TAURI__.core.convertFileSrc(settings.sound_path);
      const audio = new Audio(url);
      audio.volume = Math.min(1, Math.max(0, settings.volume));
      await audio.play();
      return;
    } catch (e) {
      console.warn("custom sound failed, falling back", e);
    }
  }
  synthBeep(Math.min(1, Math.max(0, settings.volume)));
}

function handlePhaseEnd() {
  pauseTimer();
  playSound();
  const ended = phase;
  let title = "";
  let body = "";
  let next;
  if (ended === PHASE_WORK) {
    workSessionsCompleted += 1;
    counter += 1;
    const isLong =
      workSessionsCompleted % settings.sessions_before_long_break === 0;
    next = isLong ? PHASE_LONG : PHASE_SHORT;
    title = "Focus done!";
    body = isLong ? "Long break time." : "Short break time.";
  } else {
    next = PHASE_WORK;
    title = "Break done!";
    body = "Back to focus.";
  }
  setPhaseInternal(next);
  invoke("show_main_window").catch(() => {});
  invoke("notify", { title, body }).catch(() => {});

  if (ended === PHASE_WORK && settings.fullscreen_on_focus_end) {
    // Enter fullscreen for break; reset snooze count for this focus session
    snoozeCount = 0;
    enterOverlayFullscreen();
    if (settings.auto_start_break) startTimer();
  } else {
    // When break ends naturally, always exit fullscreen before returning to focus
    if (ended !== PHASE_WORK && isOverlayFullscreen) {
      exitOverlayFullscreen();
    }
    const shouldAutoStart =
      next === PHASE_WORK ? settings.auto_start_work : settings.auto_start_break;
    if (shouldAutoStart) startTimer();
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

function setupControls() {
  $("play").addEventListener("click", () =>
    running ? pauseTimer() : startTimer(),
  );
  $("skip").addEventListener("click", () => handlePhaseEnd());
  $("snooze").addEventListener("click", () => startSnooze());
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => setPhase(b.dataset.phase));
  });
  setupHoverOpacity();
  setupResizeHandles();
}

let resizeSaveTimer = null;

function setupResizeHandles() {
  document.querySelectorAll(".resize-handle").forEach((el) => {
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // User took manual control; exit fullscreen tracking
      isOverlayFullscreen = false;
      renderSnoozeButton();
      invoke("start_resize", { direction: el.dataset.dir }).catch((err) =>
        console.warn("start_resize failed", err),
      );
    });
  });
  window.addEventListener("resize", () => {
    // Don't save size while in fullscreen mode (size was set by the system)
    if (isOverlayFullscreen) return;
    if (resizeSaveTimer) clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(() => {
      resizeSaveTimer = null;
      invoke("save_window_size").catch((err) =>
        console.warn("save_window_size failed", err),
      );
    }, 400);
  });
}

let returnCornerTimer = null;
let returnCornerSetup = false;
let returnCornerInterval = null;
let isAnimating = false;

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

async function animateToCorner() {
  isAnimating = true;
  if (returnCornerInterval) {
    clearInterval(returnCornerInterval);
    returnCornerInterval = null;
  }
  const [tx, ty] = await invoke("get_corner_position");
  const win = getCurrentWindow();
  const pos = await win.outerPosition();
  if (Math.abs(pos.x - tx) <= 1 && Math.abs(pos.y - ty) <= 1) {
    isAnimating = false;
    return;
  }
  const startX = pos.x;
  const startY = pos.y;
  const duration = 400;
  const fps = 60;
  const steps = Math.round((duration / 1000) * fps);
  let step = 0;
  returnCornerInterval = setInterval(async () => {
    try {
      step++;
      const t = step / steps;
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const x = lerp(startX, tx, ease);
      const y = lerp(startY, ty, ease);
      await invoke("set_window_position", { x, y });
      if (step >= steps) {
        clearInterval(returnCornerInterval);
        returnCornerInterval = null;
        isAnimating = false;
        await invoke("set_window_position", { x: tx, y: ty });
      }
    } catch (e) {
      console.warn("animateToCorner error", e);
      clearInterval(returnCornerInterval);
      returnCornerInterval = null;
      isAnimating = false;
    }
  }, 1000 / fps);
}

function scheduleReturnToCorner(delaySec) {
  if (returnCornerTimer) clearTimeout(returnCornerTimer);
  returnCornerTimer = setTimeout(() => {
    returnCornerTimer = null;
    animateToCorner();
  }, delaySec * 1000);
}

async function setupReturnToCorner() {
  if (returnCornerSetup) return;
  returnCornerSetup = true;
  const win = getCurrentWindow();
  await win.onMoved(() => {
    if (isAnimating) return;
    if (!settings || settings.return_to_corner_seconds === 0) return;
    if (isOverlayFullscreen) return;
    scheduleReturnToCorner(settings.return_to_corner_seconds);
  });
}

async function init() {
  settings = await invoke("get_settings");
  remainingSec = phaseDuration(phase);
  const shouldResume = loadState();
  applyPhaseClass();
  render();
  if (shouldResume) startTimer();
  setupControls();
  await setupReturnToCorner();
  await listen("settings-updated", async () => {
    const wasRunning = running;
    settings = await invoke("get_settings");
    if (!wasRunning) remainingSec = phaseDuration(phase);
    if (settings.return_to_corner_seconds === 0 && returnCornerTimer) {
      clearTimeout(returnCornerTimer);
      returnCornerTimer = null;
    }
    renderSnoozeButton();
    render();
  });
  await listen("settings-reset", async () => {
    pauseTimer();
    if (snoozeHandle) { clearInterval(snoozeHandle); snoozeHandle = null; }
    settings = await invoke("get_settings");
    phase = PHASE_WORK;
    remainingSec = phaseDuration(phase);
    workSessionsCompleted = 0;
    counter = 1;
    snoozeCount = 0;
    pendingBreakPhase = null;
    isOverlayFullscreen = false;
    if (returnCornerTimer) {
      clearTimeout(returnCornerTimer);
      returnCornerTimer = null;
    }
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
