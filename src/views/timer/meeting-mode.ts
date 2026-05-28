export interface MeetingPolicyHooks {
  onEnter: () => void;
  onExit: () => void;
  /** Whether auto-detection is enabled (master setting). Hotkey works regardless. */
  isEnabled: () => boolean;
  /** Grace period (ms) the raw signal must stay clear before auto-reverting. */
  graceMs: () => number;
}

/**
 * Applies the pomodoro meeting-mode policy on top of the kit's raw edges:
 *  - rising raw edge (enabled, not suppressed) -> enter
 *  - falling raw edge -> start a grace timer; auto-revert (onExit) only if the
 *    signal stays clear for graceMs. A new rising edge cancels the pending revert.
 *    Native calls keep the audio signal alive through mute, so they never hit
 *    grace mid-call; brief mic drops (e.g. browser mute) are ridden out.
 *  - leaveMeetingPhase(): user manually switched away from the Other phase =
 *    "I'm done" -> deactivate WITHOUT reverting phase (the user already chose
 *    one), and suppress re-entry until the signal clears.
 *  - forceToggle(): optional global hotkey - force on when idle (covers
 *    undetectable silent browser calls), force off + revert when active.
 *  - suppression lifts when raw goes false again, so a manual exit mid-call
 *    won't immediately re-trigger.
 */
export class MeetingPolicy {
  active = false;
  private lastRaw = false;
  private suppressed = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private hooks: MeetingPolicyHooks) {}

  onRaw(raw: boolean): void {
    const rising = raw && !this.lastRaw;
    this.lastRaw = raw;

    if (raw) {
      this.clearGrace(); // signal is back -> cancel any pending auto-revert
      if (rising && this.hooks.isEnabled() && !this.suppressed && !this.active) {
        this.enter();
      }
      return;
    }
    // raw cleared: re-arm auto-detection, and begin the grace countdown if active.
    this.suppressed = false;
    if (this.active) this.startGrace();
  }

  /** User switched away from the Other phase: deactivate without reverting phase. */
  leaveMeetingPhase(): void {
    if (!this.active) return;
    this.suppressed = this.lastRaw; // still in a call? don't re-enter until it ends
    this.clearGrace();
    this.active = false;
  }

  /** Optional global hotkey: force on when idle, force off (+ revert) when active. */
  forceToggle(): void {
    if (this.active) {
      this.suppressed = this.lastRaw;
      this.exit();
    } else {
      this.enter();
    }
  }

  private enter(): void {
    this.clearGrace();
    this.active = true;
    this.hooks.onEnter();
  }

  private exit(): void {
    this.clearGrace();
    this.active = false;
    this.hooks.onExit();
  }

  private startGrace(): void {
    this.clearGrace();
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.active) this.exit();
    }, this.hooks.graceMs());
  }

  private clearGrace(): void {
    if (this.graceTimer !== null) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }
}
