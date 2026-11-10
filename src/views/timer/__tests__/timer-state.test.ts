import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TimerStateMachine,
  PHASE_WORK,
  PHASE_SHORT,
  PHASE_OTHER,
  settingsChangeResetsTimer,
} from "../timer-state";

// Each test drives the machine under fake timers. The four cases below target the
// invariants the 2026-06-09 fix (commit aefb5e1) introduced; each would fail
// against the pre-fix code, which lacked the `starting` guard, the unconditional
// interval-clear on pause, and the phaseTransitionInFlight serialization.

const DURATIONS: Record<string, number> = {
  work: 1500,
  short: 300,
  long: 900,
  other: 0,
  snooze: 120,
};

function makeMachine(settingsOverrides: Record<string, unknown> = {}) {
  const fsState = {
    isOverlayFullscreen: false,
    snoozeHandle: null as ReturnType<typeof setInterval> | null,
    pendingBreakPhase: null as string | null,
  };
  const settings = {
    auto_start_break: false,
    auto_start_work: false,
    sessions_before_long_break: 4,
    fullscreen_on_focus_end: false,
    pause_music_on_break: "never",
    dnd_on_focus: false,
    ...settingsOverrides,
  };
  const deps = {
    invoke: vi.fn().mockResolvedValue(undefined),
    getSettings: () => settings,
    phaseDuration: (p: string) => DURATIONS[p] ?? 1500,
    openEvent: vi.fn().mockResolvedValue(undefined),
    closeOpenEvent: vi.fn().mockResolvedValue(undefined),
    playSound: vi.fn().mockResolvedValue(undefined),
    fsState,
    enterOverlayFullscreen: vi.fn(async () => {
      fsState.isOverlayFullscreen = true;
    }),
    exitOverlayFullscreen: vi.fn(async () => {
      fsState.isOverlayFullscreen = false;
    }),
    renderSnoozeButton: vi.fn(),
    getMeetingPolicy: () => null,
    render: vi.fn(),
    applyPhaseClass: vi.fn(),
    syncClickThrough: vi.fn(),
  };
  return { sm: new TimerStateMachine(deps), deps, fsState };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("TimerStateMachine", () => {
  it("(a) two near-simultaneous start() calls create only ONE interval (no orphan)", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { sm } = makeMachine();
    // The second call lands inside the first's await window. The synchronous
    // `starting` guard must drop it; pre-fix both slipped through (running flips
    // only after the await) and each created an interval - orphaning the first.
    const p1 = sm.start();
    const p2 = sm.start();
    await p1;
    await p2;
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(sm.tickHandle).not.toBeNull();
  });

  it("(b) pause() after a re-entrant start kills every interval (orphan can't keep ticking)", async () => {
    const { sm } = makeMachine();
    sm.remainingSec = 1500;
    const p1 = sm.start();
    const p2 = sm.start();
    await p1;
    await p2;
    vi.advanceTimersByTime(2000);
    expect(sm.remainingSec).toBe(1498);
    sm.pause();
    vi.advanceTimersByTime(10000);
    // Pre-fix an orphaned interval would keep decrementing past the pause.
    expect(sm.remainingSec).toBe(1498);
    expect(sm.running).toBe(false);
    expect(sm.tickHandle).toBeNull();
  });

  it("(c) switchPhase(WORK) from a running break sets focus duration; no stray tick overwrites it", async () => {
    const { sm } = makeMachine();
    sm.phase = PHASE_SHORT;
    sm.remainingSec = 300;
    const p1 = sm.start();
    const p2 = sm.start();
    await p1;
    await p2;
    vi.advanceTimersByTime(5000);
    expect(sm.remainingSec).toBe(295);

    sm.switchPhase(PHASE_WORK);
    expect(sm.phase).toBe(PHASE_WORK);
    expect(sm.remainingSec).toBe(1500); // focus duration, not the break's 295

    // Pre-fix, an orphaned break interval would tick here and recompute remaining
    // from the BREAK anchor, clobbering the focus duration (the skip-to-focus bug).
    vi.advanceTimersByTime(3000);
    expect(sm.remainingSec).toBe(1500);
  });

  it("(d) a natural phase-end advances exactly once (re-entrant endPhase is dropped)", async () => {
    const { sm } = makeMachine();
    sm.phase = PHASE_WORK;
    sm.remainingSec = 1;
    await sm.start();

    // Fire two phase-ends back to back; the phaseTransitionInFlight guard must
    // drop the second. Pre-fix this double-advanced (work->break->work).
    const e1 = sm.endPhase(true);
    const e2 = sm.endPhase(true);
    await e1;
    await e2;

    expect(sm.workSessionsCompleted).toBe(1);
    expect(sm.phase).toBe(PHASE_SHORT);
    expect(sm.running).toBe(false);
  });

  it("(e) snoozing twice keeps the original pre-snooze phase; skip returns to it, not to another snooze", async () => {
    // Mirrors shared/fullscreen.ts's startSnooze(): pause, conditionally capture
    // the phase being left (never overwrite pendingBreakPhase with "snooze"
    // itself), re-anchor at SNOOZE_DURATION, restart. Regression for the bug
    // fixed alongside commit 5a4936b: before that guard, a second snooze while
    // already snoozing corrupted pendingBreakPhase to "snooze", so the next
    // skip re-entered fullscreen into another snooze instead of the real break.
    const { sm, fsState } = makeMachine();
    sm.phase = PHASE_SHORT;
    sm.remainingSec = 300;
    await sm.start();
    vi.advanceTimersByTime(5000);

    if (sm.phase !== "snooze") fsState.pendingBreakPhase = sm.phase;
    sm.pause("switch");
    sm.phase = "snooze";
    sm.remainingSec = 120;
    await sm.start();

    if (sm.phase !== "snooze") fsState.pendingBreakPhase = sm.phase;
    sm.pause("switch");
    sm.phase = "snooze";
    sm.remainingSec = 120;
    await sm.start();
    expect(fsState.pendingBreakPhase).toBe(PHASE_SHORT);

    await sm.endPhase();
    expect(sm.phase).toBe(PHASE_SHORT);
    expect(fsState.pendingBreakPhase).toBeNull();
  });

  describe("music pause/resume while media_pause_if_playing is still in flight", () => {
    // The Rust call enumerates and pauses media sessions, so it resolves well
    // after pause() returns. Hold it open to reproduce that window.
    function holdMusicPause(deps: ReturnType<typeof makeMachine>["deps"]) {
      let resolvePause!: (paused: boolean) => void;
      deps.invoke.mockImplementation((cmd: string) =>
        cmd === "media_pause_if_playing"
          ? new Promise((r) => { resolvePause = r; })
          : Promise.resolve(undefined),
      );
      return (paused: boolean) => resolvePause(paused);
    }
    const calls = (deps: ReturnType<typeof makeMachine>["deps"], cmd: string) =>
      deps.invoke.mock.calls.filter(([c]) => c === cmd).length;

    it("resumes music when focus is restarted before the pause call lands", async () => {
      const { sm, deps } = makeMachine({ pause_music_on_break: "not_running_focused" });
      await sm.start();
      const finishPause = holdMusicPause(deps);
      sm.pause();
      const started = sm.start();
      finishPause(true);
      await started;
      expect(calls(deps, "media_resume")).toBe(1);
      expect(sm.musicPausedByApp).toBe(false);
    });

    it("an auto-started break does not re-pause (and wipe) what the focus end just paused", async () => {
      const { sm, deps } = makeMachine({
        pause_music_on_break: "not_running_focused",
        auto_start_break: true,
      });
      sm.remainingSec = 1;
      await sm.start();
      const finishPause = holdMusicPause(deps);
      const ended = sm.endPhase(true);
      await vi.advanceTimersByTimeAsync(0);
      finishPause(true);
      await ended;
      expect(sm.phase).toBe(PHASE_SHORT);
      expect(sm.running).toBe(true);
      expect(calls(deps, "media_pause_if_playing")).toBe(1);
      expect(sm.musicPausedByApp).toBe(true);
    });
  });

  it("stopwatch (PHASE_OTHER) counts up from its anchor instead of down", async () => {
    const { sm } = makeMachine();
    sm.phase = PHASE_OTHER;
    sm.remainingSec = 0;
    await sm.start();
    vi.advanceTimersByTime(4000);
    expect(sm.remainingSec).toBe(4);
  });
});

describe("settingsChangeResetsTimer", () => {
  it("leaves a paused timer alone when the save did not change its phase length", () => {
    // A bar drag persists bar_edge through a settings save.
    expect(settingsChangeResetsTimer(false, 1500, 1500)).toBe(false);
    expect(settingsChangeResetsTimer(false, 0, 0)).toBe(false);
  });

  it("re-seeds a paused timer whose phase length changed", () => {
    expect(settingsChangeResetsTimer(false, 1500, 1800)).toBe(true);
  });

  it("never touches a running timer", () => {
    expect(settingsChangeResetsTimer(true, 1500, 1800)).toBe(false);
  });
});
