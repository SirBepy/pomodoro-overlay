# tauri-kit: prettier number input field

## Goal

Make the number input field in tauri-kit look nicer. Either add custom up/down stepper buttons, or at minimum hide the browser's default spinner buttons.

## Context

- Number inputs render in `vendor/tauri_kit/frontend/settings/fields.ts:34` - `<input type="number" class="kit-input">` inside a `kit-row` label.
- Styling lives in `vendor/tauri_kit/frontend/settings/styles/` (`components.css`, `tokens.css`).
- Default browser spinners are ugly/inconsistent across webview versions.
- tauri-kit is a submodule (`vendor/tauri_kit`), so changes land in that repo and get synced.

## Approach

Two tiers, pick based on effort:
1. Minimum: hide native spinners via CSS - `input[type=number]::-webkit-inner-spin-button { appearance: none; }` plus `appearance: textfield` on the input. Add to `components.css` scoped to `.kit-input`.
2. Better: custom up/down stepper buttons (Phosphor `ph-caret-up` / `ph-caret-down`) wired to increment/decrement the bound value, respecting min/max/step. Lives in `fields.ts` number branch + matching CSS.

## Acceptance

- No default browser spinner visible on number fields.
- If custom buttons added: clicking steps the value, respects min/max, fires the same change/save path as typing.
- Settings field tests still pass (`vendor/tauri_kit` test suite).
