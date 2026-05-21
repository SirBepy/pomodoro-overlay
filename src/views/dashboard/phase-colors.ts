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
