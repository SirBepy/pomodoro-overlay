export interface MeetingPolicyHooks {
  onEnter: () => void;
  onExit: () => void;
  /** Whether auto-detection is enabled (master setting). Hotkey works regardless. */
  isEnabled: () => boolean;
  /** Grace period (ms) the raw signal must stay clear before auto-reverting. */
  graceMs: () => number;
  /** Injectable clock (defaults to Date.now) - lets tests control time. */
  now?: () => number;
}

/**
 * Applies the pomodoro meeting-mode policy on top of the kit's raw edges:
 *  - rising raw edge (enabled, not suppressed) -> enter
 *  - falling raw edge -> arm a wall-clock grace deadline; tick() auto-reverts
 *    (onExit) once now >= deadline. A new rising edge cancels it. Native calls
 *    keep the audio signal alive through mute, so they never hit grace mid-call;
 *    brief mic drops are ridden out.
 *  - leaveMeetingPhase(): user manually left the Other phase = "I'm done" ->
 *    deactivate WITHOUT onExit (the user already chose a phase), and suppress
 *    re-entry until the signal clears.
 *  - forceToggle(): optional global hotkey - force on when idle, force off when
 *    active (runs onExit -> the end action).
 *
 * The grace uses a wall-clock deadline checked by tick() (driven by an external
 * interval) rather than setTimeout, so background timer throttling or PC sleep
 * can't stop the revert - the next tick simply sees the deadline has passed.
 */
export class MeetingPolicy {
  active = false;
  private lastRaw = false;
  private suppressed = false;
  private graceDeadline: number | null = null;
  private now: () => number;

  constructor(private hooks: MeetingPolicyHooks) {
    this.now = hooks.now ?? (() => Date.now());
  }

  onRaw(raw: boolean): void {
    const rising = raw && !this.lastRaw;
    this.lastRaw = raw;

    if (raw) {
      this.graceDeadline = null; // signal is back -> cancel any pending revert
      if (rising && this.hooks.isEnabled() && !this.suppressed && !this.active) {
        this.enter();
      }
      return;
    }
    // raw cleared: re-arm auto-detection, and start the grace countdown if active.
    this.suppressed = false;
    if (this.active) this.graceDeadline = this.now() + this.hooks.graceMs();
  }

  /** Drive the grace-based auto-revert. Call periodically from an interval. */
  tick(): void {
    if (this.active && this.graceDeadline !== null && this.now() >= this.graceDeadline) {
      this.exit();
    }
  }

  /** User switched away from the Other phase: deactivate without reverting phase. */
  leaveMeetingPhase(): void {
    if (!this.active) return;
    this.suppressed = this.lastRaw; // still in a call? don't re-enter until it ends
    this.graceDeadline = null;
    this.active = false;
  }

  /** Optional global hotkey: force on when idle, force off (+ end action) when active. */
  forceToggle(): void {
    if (this.active) {
      this.suppressed = this.lastRaw;
      this.exit();
    } else {
      this.enter();
    }
  }

  private enter(): void {
    this.graceDeadline = null;
    this.active = true;
    this.hooks.onEnter();
  }

  private exit(): void {
    this.graceDeadline = null;
    this.active = false;
    this.hooks.onExit();
  }
}
