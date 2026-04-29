const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

const PHASE_WORK = "work";
const PHASE_SHORT = "short";
const PHASE_LONG = "long";

let settings = null;
let phase = PHASE_WORK;
let remainingSec = 25 * 60;
let running = false;
let tickHandle = null;
let workSessionsCompleted = 0;
let counter = 1;

const $ = (id) => document.getElementById(id);

function phaseDuration(p) {
  if (!settings) return 25 * 60;
  if (p === PHASE_SHORT) return settings.short_break_minutes * 60;
  if (p === PHASE_LONG) return settings.long_break_minutes * 60;
  return settings.work_minutes * 60;
}

function phaseLabel(p) {
  if (p === PHASE_SHORT) return "Short Break";
  if (p === PHASE_LONG) return "Long Break";
  return "Focus";
}

function applyPhaseClass() {
  const c = $("container");
  c.classList.remove("phase-work", "phase-short", "phase-long");
  c.classList.add(`phase-${phase}`);
  document.querySelectorAll(".phase-btn").forEach((b) => {
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
  document.body.style.opacity = isHovered
    ? "1"
    : String(settings.idle_opacity ?? 0.5);
}

function setupHoverOpacity() {
  const c = $("container");
  c.addEventListener("mouseenter", () => {
    isHovered = true;
    applyVisibility();
  });
  c.addEventListener("mouseleave", () => {
    isHovered = false;
    applyVisibility();
  });
}

function render() {
  const t = fmt(remainingSec);
  document.querySelector(".big-time").textContent = t;
  $("play").textContent = `${running ? "PAUSE" : "START"} #${counter}`;
  applyVisibility();
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

function resetTimer() {
  pauseTimer();
  remainingSec = phaseDuration(phase);
  render();
}

function setPhase(p) {
  pauseTimer();
  phase = p;
  remainingSec = phaseDuration(phase);
  applyPhaseClass();
  render();
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
  setPhase(next);
  invoke("notify", { title, body }).catch(() => {});
  if (settings.auto_advance) startTimer();
}

function setupControls() {
  $("play").addEventListener("click", () =>
    running ? pauseTimer() : startTimer(),
  );
  $("reset").addEventListener("click", resetTimer);
  $("skip").addEventListener("click", () => handlePhaseEnd());
  $("open-settings").addEventListener("click", () =>
    invoke("open_settings_window"),
  );
  document.querySelectorAll(".phase-btn").forEach((b) => {
    b.addEventListener("click", () => setPhase(b.dataset.phase));
  });
  setupHoverOpacity();
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
    scheduleReturnToCorner(settings.return_to_corner_seconds);
  });
}

async function init() {
  settings = await invoke("get_settings");
  remainingSec = phaseDuration(phase);
  applyPhaseClass();
  render();
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
    render();
  });
}

init();
