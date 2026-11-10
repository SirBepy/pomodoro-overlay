// @ts-nocheck
import { PHASE_SNOOZE, fsState } from "../../shared/fullscreen";

const { invoke } = window.__TAURI__.core;

// Owns overlay opacity + click-through state, driven by hover and modifier
// polling. Mirrors the return-to-corner.ts / timer-edit.ts module pattern:
// main.ts injects getters and keeps the returned syncClickThrough/applyVisibility.
export function setupVisibility({ getSettings, getRunning, getPhase }) {
  let isHovered = false;
  let modifierHeld = false;
  let isClickThrough = false;

  function clickThroughActive() {
    const settings = getSettings();
    const mod = settings?.click_through_modifier ?? "none";
    return getRunning() && mod !== "none" && !modifierHeld && !fsState.isOverlayFullscreen;
  }

  function applyVisibility() {
    const settings = getSettings();
    if (!settings) return;
    const fadeWhen = settings.fade_when ?? "always";
    const shouldFade =
      fadeWhen === "always" || (fadeWhen === "running" && getRunning());
    const fadingForClickThrough = clickThroughActive() && isHovered;
    if (fadingForClickThrough) {
      document.body.style.opacity = "0";
    } else {
      document.body.style.opacity =
        isHovered || !shouldFade ? "1" : String(settings.idle_opacity ?? 0.5);
    }
    const expanded =
      !fadingForClickThrough &&
      (isHovered || (!getRunning() && getPhase() !== PHASE_SNOOZE));
    document.getElementById("app").classList.toggle("is-hovered", expanded);
  }

  async function syncClickThrough() {
    const desired = clickThroughActive();
    if (desired === isClickThrough) return;
    isClickThrough = desired;
    try {
      await invoke("set_click_through", { enabled: desired });
    } catch (e) {
      console.warn("set_click_through failed", e);
    }
  }

  // Poll cursor-over-window + modifier key every 150ms; re-apply on change.
  setInterval(async () => {
    try {
      const mod = getSettings()?.click_through_modifier ?? "none";
      const heldPromise = mod === "none"
        ? Promise.resolve(false)
        : invoke("is_modifier_held", { modifier: mod });
      const [over, held] = await Promise.all([
        invoke("is_cursor_over_window"),
        heldPromise,
      ]);
      const changed = over !== isHovered || held !== modifierHeld;
      if (changed) {
        isHovered = over;
        modifierHeld = held;
        applyVisibility();
        syncClickThrough();
      }
    } catch (e) {
      console.warn("hover/modifier poll failed", e);
    }
  }, 150);

  return { syncClickThrough, applyVisibility };
}
