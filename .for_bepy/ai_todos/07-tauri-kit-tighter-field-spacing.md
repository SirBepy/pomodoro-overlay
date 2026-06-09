# tauri-kit: tighten spacing between fields/buttons

## Goal

Reduce the padding/gap between buttons and input fields in tauri-kit settings. It's currently larger than wanted. Match the slimmer, nicer spacing used in the claude_usage_in_taskbar project.

## Context

- Row/field spacing comes from `vendor/tauri_kit/frontend/settings/styles/` - `structure.css` and `components.css` (the `kit-row`, `kit-input` classes), with spacing tokens in `tokens.css`.
- Reference for the target look: the `claude_usage_in_taskbar` project, which Joe says has slimmer, better spacing. Inspect its settings/spacing CSS before changing values here.
- tauri-kit is a submodule (`vendor/tauri_kit`); changes land there.

## Approach

1. Open claude_usage_in_taskbar, find its field/row spacing values (gap, padding, margin between rows).
2. Compare against tauri-kit's `tokens.css` spacing scale + `structure.css`/`components.css` row rules.
3. Adjust tauri-kit tokens/row spacing to match the slimmer reference. Prefer changing a shared spacing token over per-component overrides so it stays scalable.

## Acceptance

- Vertical gap between settings rows visibly tighter, matching claude_usage_in_taskbar.
- No clipping/overlap of labels or controls at the tighter spacing.
- tauri-kit tests pass; settings UI still readable in PomodoroOverlay after submodule sync.
