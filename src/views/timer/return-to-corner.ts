// @ts-nocheck
import { fsState } from "../../shared/fullscreen";

const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;

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

export function scheduleReturnToCorner(delaySec) {
  if (returnCornerTimer) clearTimeout(returnCornerTimer);
  returnCornerTimer = setTimeout(() => {
    returnCornerTimer = null;
    animateToCorner();
  }, delaySec * 1000);
}

export function clearReturnCornerTimer() {
  if (returnCornerTimer) {
    clearTimeout(returnCornerTimer);
    returnCornerTimer = null;
  }
}

export function getReturnCornerTimer() {
  return returnCornerTimer;
}

export async function setupReturnToCorner(getSettings) {
  if (returnCornerSetup) return;
  returnCornerSetup = true;
  const win = getCurrentWindow();
  await win.onMoved(() => {
    if (isAnimating) return;
    const settings = getSettings();
    if (!settings || settings.return_to_corner_seconds === 0) return;
    if (fsState.isOverlayFullscreen) return;
    scheduleReturnToCorner(settings.return_to_corner_seconds);
  });
}
