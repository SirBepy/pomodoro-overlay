# Share the navRow helper between root and system pages

## Goal
Stop hand-repeating the nav-row markup in `system.ts` for the About link; reuse the existing helper.

## Context
`vendor/tauri_kit/frontend/settings/pages/root.ts` defines a small `navRow(label, dataNav, onClick)` helper that emits the `.kit-row.kit-nav-row` markup. `system.ts` builds the same nav-row inline for the About link (around line 57 of `system.ts`) instead of reusing the helper.

## Approach
1. Move `navRow` (and the `sectionId` helper if it's only used in `root.ts` - or leave it, since it's specific to schema sections) into a shared module like `vendor/tauri_kit/frontend/settings/pages/nav-utils.ts`, or expose `navRow` from a new `pages/parts.ts`.
2. Import in both `root.ts` and `system.ts`; replace the inline About row with `navRow("About", "about", deps.onNavAbout)`.
3. Re-run kit tests.

## Acceptance
- Single `navRow` definition.
- `system.ts` About row uses it.
- No test regressions.
