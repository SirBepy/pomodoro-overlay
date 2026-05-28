export interface MeetingPolicyHooks {
  onEnter: () => void;
  onExit: () => void;
  /** Whether auto-detection is enabled (master setting). Hotkey works regardless. */
  isEnabled: () => boolean;
}

/**
 * Applies the pomodoro meeting-mode policy on top of the kit's raw edges:
 *  - rising raw edge (and enabled, not suppressed) -> enter
 *  - "stay until manual": falling raw edge does NOT exit
 *  - hotkey toggles: active -> exit + arm suppression; inactive -> force enter
 *  - suppression (armed by a manual force-off while a call is still detected)
 *    lifts only when raw goes false again (edge re-arm), so forcing off mid-call
 *    won't immediately re-trigger.
 */
export class MeetingPolicy {
  active = false;
  private lastRaw = false;
  private suppressed = false;

  constructor(private hooks: MeetingPolicyHooks) {}

  onRaw(raw: boolean): void {
    const rising = raw && !this.lastRaw;
    this.lastRaw = raw;

    if (!raw) {
      // Raw cleared: re-arm auto-detection.
      this.suppressed = false;
      return;
    }
    if (rising && this.hooks.isEnabled() && !this.suppressed && !this.active) {
      this.enter();
    }
  }

  toggleHotkey(): void {
    if (this.active) {
      // Force off. If a call is still detected, suppress until it ends.
      this.suppressed = this.lastRaw;
      this.exit();
    } else {
      this.enter();
    }
  }

  private enter(): void {
    this.active = true;
    this.hooks.onEnter();
  }

  private exit(): void {
    this.active = false;
    this.hooks.onExit();
  }
}
