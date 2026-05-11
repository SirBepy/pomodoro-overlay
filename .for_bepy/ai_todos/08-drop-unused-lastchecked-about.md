# Drop unused `lastChecked` from About page deps

## Goal
Remove the `lastChecked` field that's plumbed through `aboutPage` deps but never rendered.

## Context
`vendor/tauri_kit/frontend/settings/pages/about.ts` declares `lastChecked: Date | null` in `AboutPageDeps` (around line 15) but the render doesn't use it. `vendor/tauri_kit/frontend/settings/renderer.ts` passes `lastChecked: null` to `aboutPage(...)` with a comment "future: kit caches last check timestamp". A previous commit explicitly removed the "Last checked" UI row (see existing about.test.ts assertion `does not render Last checked row`).

## Approach
1. Remove `lastChecked` from `AboutPageDeps` in `about.ts`.
2. Remove the `lastChecked: null` line from the `aboutPage({...})` call in `renderer.ts`.
3. Verify nothing else in the kit references it (grep).
4. Re-run kit tests.

## Acceptance
- `lastChecked` no longer in the kit.
- Tests + build clean.
- If kit needs caching of last-check timestamps in the future, add it back when the UI actually consumes it.
