/**
 * Timer state machine, extracted from main.ts so the pause / skip / auto-advance
 * logic is unit-testable in isolation (it shipped 3 release-breaking bugs with
 * zero coverage). The core owns all timer/phase state plus the interval
 * lifecycle, the wall-clock anchor math, the start/pause re-entrancy guard, and
 * the phase-transition serialization guard. Every side effect (IPC, stats,
 * sounds, fullscreen, rendering) is injected via `TimerDeps`, so this module has
 * NO hard dependency on window.__TAURI__ / the DOM and can run under fake timers.
 */

export const PHASE_WORK = "work";
export const PHASE_SHORT = "short";
export const PHASE_LONG = "long";
export const PHASE_OTHER = "other";
// Local copy of the snooze phase value (canonical export lives in shared/fullscreen,
// but importing that module here would pull in its top-level window.__TAURI__ access
// and break unit testing). Value must stay "snooze".
const PHASE_SNOOZE = "snooze";

/** A loose stand-in for the meeting policy; the machine only reads `active`. */
interface MeetingPolicyLike {
  active: boolean;
  leaveMeetingPhase: () => void;
}

/** The mutable fullscreen/snooze state object shared with shared/fullscreen. */
interface FsStateLike {
  isOverlayFullscreen: boolean;
  snoozeHandle: ReturnType<typeof setInterval> | null;
  pendingBreakPhase: string | null;
  [key: string]: unknown;
}

export interface TimerDeps {
  /** Wall-clock source; injectable so fake timers fully control time. */
  now?: () => number;
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
  getSettings: () => any;
  phaseDuration: (phase: string) => number;
  // Stats event lifecycle.
  openEvent: (
    phase: string,
    configuredSeconds: number | null,
    resumeSession: boolean,
  ) => Promise<void>;
  closeOpenEvent: (endedBy: string) => Promise<void>;
  // Phase-end chime.
  playSound: () => Promise<void>;
  // Fullscreen module surface.
  fsState: FsStateLike;
  enterOverlayFullscreen: () => Promise<void>;
  exitOverlayFullscreen: () => Promise<void>;
  renderSnoozeButton: () => void;
  // Meeting policy (constructed after the machine; read lazily).
  getMeetingPolicy: () => MeetingPolicyLike | null;
  // View / DOM side effects.
  render: () => void;
  applyPhaseClass: () => void;
  syncClickThrough: () => void;
  /** Widget bridge: reports the current snapshot to the Rust-side cache. */
  reportState?: () => void;
  /** Runs just before a focus session hands over to the fullscreen break. */
  prepareFullscreenBreak?: () => void;
}

export class TimerStateMachine {
  phase: string = PHASE_WORK;
  remainingSec = 25 * 60;
  running = false;
  /** Synchronous re-entrancy guard across start()'s await window. */
  starting = false;
  tickHandle: ReturnType<typeof setInterval> | null = null;
  workSessionsCompleted = 0;
  musicPausedByApp = false;
  /**
   * pause()'s media_pause_if_playing call, which sets musicPausedByApp only once
   * it resolves. start() awaits it: deciding before it lands either skips the
   * resume, or fires a second pause call whose empty result overwrites the
   * Rust-side list of paused sessions, so the later resume has nothing to play.
   */
  private pendingMusicPause: Promise<void> | null = null;
  dndEnabledByApp = false;
  /** Wall-clock when the current run-interval began. */
  intervalStartMs = 0;
  /** remainingSec snapshot at that moment (the anchor). */
  intervalStartRemainingSec = 0;
  /** Serializes async phase transitions so a spammed skip can't reorder them. */
  phaseTransitionInFlight = false;

  private readonly deps: TimerDeps;
  private readonly now: () => number;

  constructor(deps: TimerDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  // ── Tick loop ──────────────────────────────────────────────
  private tick(): void {
    const elapsedSec = Math.floor((this.now() - this.intervalStartMs) / 1000);
    if (this.phase === PHASE_OTHER) {
      this.remainingSec = this.intervalStartRemainingSec + elapsedSec; // stopwatch: count up
      this.deps.render();
      return;
    }
    this.remainingSec = Math.max(0, this.intervalStartRemainingSec - elapsedSec);
    if (this.remainingSec <= 0) {
      this.endPhase(true).catch((e) => console.warn("handlePhaseEnd error", e));
      return;
    }
    this.deps.render();
  }

  // ── Start / pause ──────────────────────────────────────────
  async start(): Promise<void> {
    // `running` flips only after the await below, so a synchronous guard on it
    // alone lets a re-entrant call slip through the await window and create a
    // second interval (orphaning the first - its handle is overwritten). The
    // `starting` flag closes that window synchronously.
    if (this.running || this.starting) return;
    this.starting = true;
    try {
      const settings = this.deps.getSettings();
      if (this.phase === PHASE_WORK && this.deps.fsState.isOverlayFullscreen) {
        this.deps.exitOverlayFullscreen();
      }
      await this.pendingMusicPause;
      const pmob = settings?.pause_music_on_break;
      if (pmob === "on_break" || pmob === "not_running_focused") {
        if (this.phase === PHASE_WORK && this.musicPausedByApp) {
          this.deps.invoke("media_resume").catch(() => {});
          this.musicPausedByApp = false;
        } else if (
          (this.phase === PHASE_SHORT || this.phase === PHASE_LONG) &&
          !this.musicPausedByApp
        ) {
          const paused = await this.deps.invoke("media_pause_if_playing").catch(() => false);
          if (paused) this.musicPausedByApp = true;
        }
      }
      if (settings?.dnd_on_focus && this.phase === PHASE_WORK && !this.dndEnabledByApp) {
        this.deps.invoke("enable_dnd").catch(() => {});
        this.dndEnabledByApp = true;
      }
      // Stats: open event. If we're resuming after a pause (same phase still set),
      // share the existing session_id.
      const configured = this.phase === PHASE_OTHER ? null : this.deps.phaseDuration(this.phase);
      await this.deps.openEvent(this.phase, configured, /* resumeSession */ true);
      this.running = true;
      this.intervalStartMs = this.now();
      this.intervalStartRemainingSec = this.remainingSec;
      // Defensive: never let two intervals coexist. Clear any stray handle before
      // assigning the new one so an orphaned tick can't survive.
      if (this.tickHandle !== null) {
        clearInterval(this.tickHandle);
        this.tickHandle = null;
      }
      this.tickHandle = setInterval(() => this.tick(), 1000);
      this.deps.syncClickThrough();
      this.deps.render();
      this.deps.reportState?.();
    } finally {
      this.starting = false;
    }
  }

  pause(endedBy = "pause"): void {
    // Always kill any live interval first, regardless of `running` - this is the
    // single chokepoint that guarantees no tick survives a pause.
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    if (!this.running) return;
    this.running = false;
    this.deps.closeOpenEvent(endedBy).catch(() => {});
    if (this.dndEnabledByApp) {
      this.deps.invoke("disable_dnd").catch(() => {});
      this.dndEnabledByApp = false;
    }
    const settings = this.deps.getSettings();
    if (
      settings?.pause_music_on_break === "not_running_focused" &&
      this.phase === PHASE_WORK &&
      !this.musicPausedByApp
    ) {
      this.pendingMusicPause = this.deps
        .invoke("media_pause_if_playing")
        .then((paused) => {
          if (paused) this.musicPausedByApp = true;
        })
        .catch(() => {});
    }
    this.deps.syncClickThrough();
    this.deps.render();
    this.deps.reportState?.();
  }

  // ── Phase switching ────────────────────────────────────────
  /**
   * Manually leaving the stopwatch phase (tab click, skip button, skip keybind)
   * means "meeting's over": drop meeting-mode so sounds/fullscreen resume and the
   * next meeting can re-trigger.
   */
  private leaveMeetingIfActive(nextPhase: string): void {
    const policy = this.deps.getMeetingPolicy();
    if (policy?.active && nextPhase !== PHASE_OTHER) {
      policy.leaveMeetingPhase();
    }
  }

  /**
   * User-driven phase switch (tab click / meeting enter-exit). Cancels snooze and
   * resets the countdown to the target phase's duration. (The todo's `skipTo`.)
   */
  switchPhase(p: string): void {
    // Snooze is cancelled when user manually switches phase.
    if (this.deps.fsState.snoozeHandle) {
      clearInterval(this.deps.fsState.snoozeHandle);
      this.deps.fsState.snoozeHandle = null;
      this.deps.fsState.pendingBreakPhase = null;
    }
    this.leaveMeetingIfActive(p);
    this.pause("switch");
    this.phase = p;
    this.remainingSec = this.deps.phaseDuration(this.phase);
    this.deps.applyPhaseClass();
    this.deps.render();
    this.deps.reportState?.();
  }

  /** Internal phase switch without fullscreen/snooze side effects. */
  private setPhaseInternal(p: string): void {
    this.leaveMeetingIfActive(p);
    this.pause();
    this.phase = p;
    this.remainingSec = this.deps.phaseDuration(this.phase);
    this.deps.applyPhaseClass();
    this.deps.render();
    this.deps.reportState?.();
  }

  // ── Phase end (auto-advance / skip) ────────────────────────
  /**
   * Serializes phase transitions. Each transition fires async fullscreen
   * enter/exit invokes; if a second skip starts while the first is mid-flight,
   * the window ops can reorder at the OS level and leave the overlay stuck
   * fullscreen during a WORK phase. Drop re-entrant calls while one runs.
   */
  async endPhase(natural = false): Promise<void> {
    if (this.phaseTransitionInFlight) return;
    this.phaseTransitionInFlight = true;
    try {
      await this.runPhaseEnd(natural);
    } finally {
      this.phaseTransitionInFlight = false;
    }
  }

  private async runPhaseEnd(natural = false): Promise<void> {
    if (this.running) {
      await this.deps.closeOpenEvent(natural ? "natural" : "skip");
    }
    this.pause();
    const policy = this.deps.getMeetingPolicy();
    if (natural && !policy?.active) this.deps.playSound().catch(() => {});
    const ended = this.phase;
    const settings = this.deps.getSettings();

    if (ended === PHASE_SNOOZE) {
      const next = this.deps.fsState.pendingBreakPhase ?? PHASE_SHORT;
      this.deps.fsState.pendingBreakPhase = null;
      this.setPhaseInternal(next);
      this.deps.invoke("show_main_window").catch(() => {});
      await this.deps.enterOverlayFullscreen();
      this.deps.renderSnoozeButton();
      if (settings.auto_start_break) await this.start();
      return;
    }

    if (ended === PHASE_OTHER) {
      // Stopwatch ended manually (skip). Just return to work; do not auto-start.
      this.setPhaseInternal(PHASE_WORK);
      return;
    }

    let next: string;
    if (ended === PHASE_WORK) {
      this.workSessionsCompleted += 1;
      const isLong = this.workSessionsCompleted % settings.sessions_before_long_break === 0;
      next = isLong ? PHASE_LONG : PHASE_SHORT;
    } else {
      next = PHASE_WORK;
    }
    const goesFullscreen =
      ended === PHASE_WORK && settings.fullscreen_on_focus_end && !policy?.active;
    // Before the phase flips: the re-render below would otherwise take the focus
    // sign down and restore the corner, flashing it before the break opens.
    if (goesFullscreen) this.deps.prepareFullscreenBreak?.();
    this.setPhaseInternal(next);
    this.deps.invoke("show_main_window").catch(() => {});

    if (goesFullscreen) {
      await this.deps.enterOverlayFullscreen();
      if (settings.auto_start_break) await this.start();
    } else {
      if (ended !== PHASE_WORK && this.deps.fsState.isOverlayFullscreen) {
        await this.deps.exitOverlayFullscreen();
      }
      const shouldAutoStart =
        next === PHASE_WORK ? settings.auto_start_work : settings.auto_start_break;
      if (shouldAutoStart) await this.start();
    }
  }
}
