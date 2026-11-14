// Dashboard phase colors. These MUST mirror the overlay phase backgrounds
// defined as `.phase-* { --bg }` in src/styles/base.css so a phase reads as the
// same color in the dashboard as it does on the timer overlay. Do not invent
// values here - if a background changes in base.css, update it here too.
// `idle` is gap time (no overlay background); amber is a deliberate neutral.
export const PHASE_COLORS = {
  work: "#ba4949",   // .phase-work  --bg
  short: "#38858a",  // .phase-short --bg
  long: "#397097",   // .phase-long  --bg
  other: "#4a8b3f",  // .phase-other --bg
  snooze: "#6b35a5", // .phase-snooze --bg
  idle: "#f5a623",   // gap time (no overlay phase)
};

export type ColorKey = keyof typeof PHASE_COLORS;

// Phase colors alone fail the colorblind and contrast checks (short vs long
// break are near-identical, snooze purple is dim on the dark surface), so every
// color is paired with an icon and a name wherever it carries meaning.
// Phosphor has no `stopwatch` glyph in the shipped web build; clock-countdown
// keeps the Stopwatch chip distinct from the Work chip, which owns `timer`.
export const PHASE_ICONS: Record<ColorKey, string> = {
  work: "timer",
  short: "coffee",
  long: "couch",
  other: "clock-countdown",
  snooze: "alarm",
  idle: "hourglass",
};

export const PHASE_LABELS: Record<ColorKey, string> = {
  work: "Work",
  short: "Short break",
  long: "Long break",
  other: "Stopwatch",
  snooze: "Snooze",
  idle: "Idle",
};

/** Inline style that exposes every phase color as `--c-<key>` so CSS can
 *  color-mix them. Generated from PHASE_COLORS to keep one source of truth. */
export function phaseVarsStyle(): string {
  return (Object.keys(PHASE_COLORS) as ColorKey[])
    .map((k) => `--c-${k}:${PHASE_COLORS[k]}`)
    .join(";");
}
