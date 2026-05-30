// @ts-nocheck
import { fsState, renderSnoozeButton } from "../../shared/fullscreen";
import { isEditMode } from "./timer-edit";
import { getReturnCornerTimer, clearReturnCornerTimer } from "./return-to-corner";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const PHASE_WORK = "work";

export interface WindowEventDeps {
  getRunning: () => boolean;
  pause: (endedBy?: string) => void;
  start: () => Promise<void>;
  skipPhase: () => Promise<void>;
  getSettings: () => any;
  setSettings: (s: any) => void;
  getPhase: () => string;
  setPhase: (p: string) => void;
  setRemainingSec: (v: number) => void;
  setWorkSessionsCompleted: (v: number) => void;
  getMusicPausedByApp: () => boolean;
  setMusicPausedByApp: (v: boolean) => void;
  getDndEnabledByApp: () => boolean;
  setDndEnabledByApp: (v: boolean) => void;
  syncClickThrough: () => void;
  render: () => void;
  applyPhaseClass: () => void;
  exitEditMode: (confirm: boolean) => void;
  phaseDuration: (phase: string) => number;
}

export async function setupWindowEvents(deps: WindowEventDeps): Promise<void> {
  const {
    getRunning, pause, start, skipPhase, getSettings, setSettings, getPhase, setPhase,
    setRemainingSec, setWorkSessionsCompleted,
    getMusicPausedByApp, setMusicPausedByApp,
    getDndEnabledByApp, setDndEnabledByApp,
    syncClickThrough, render, applyPhaseClass, exitEditMode, phaseDuration,
  } = deps;

  await listen("main-window-hidden", () => {
    invoke("disable_keep_awake").catch(() => {});
  });
  await listen("main-window-shown", () => {
    if (fsState.isOverlayFullscreen && getSettings()?.keep_awake_during_fullscreen) {
      invoke("enable_keep_awake").catch(() => {});
    }
  });
  await listen("settings-updated", async () => {
    if (isEditMode()) exitEditMode(true);
    const wasRunning = getRunning();
    setSettings(await invoke("get_settings"));
    if (!wasRunning) setRemainingSec(phaseDuration(getPhase()));
    if (getSettings().return_to_corner_seconds === 0 && getReturnCornerTimer()) {
      clearReturnCornerTimer();
    }
    syncClickThrough();
    renderSnoozeButton();
    render();
  });
  await listen("settings-reset", async () => {
    pause();
    if (fsState.snoozeHandle) { clearInterval(fsState.snoozeHandle); fsState.snoozeHandle = null; }
    setSettings(await invoke("get_settings"));
    setPhase(PHASE_WORK);
    setRemainingSec(phaseDuration(PHASE_WORK));
    setWorkSessionsCompleted(0);
    setMusicPausedByApp(false);
    if (getDndEnabledByApp()) {
      invoke("disable_dnd").catch(() => {});
      setDndEnabledByApp(false);
    }
    fsState.pendingBreakPhase = null;
    fsState.isOverlayFullscreen = false;
    document.body.classList.remove("is-fullscreen");
    invoke("disable_keep_awake").catch(() => {});
    clearReturnCornerTimer();
    try {
      await invoke("set_window_size");
    } catch (e) {
      console.warn("set_window_size failed", e);
    }
    applyPhaseClass();
    renderSnoozeButton();
    render();
  });
  await listen("hotkey-pause", () => {
    if (getRunning()) pause();
    else start().catch(() => {});
  });
  await listen("hotkey-skip", () => {
    skipPhase().catch(() => {});
  });
}
