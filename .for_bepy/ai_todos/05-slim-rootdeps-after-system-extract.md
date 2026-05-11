# Slim RootDeps interface and imports in root.ts

## Goal
Remove dead props/imports left behind in `vendor/tauri_kit/frontend/settings/pages/root.ts` after the System subpage extracted the System category and Danger zone.

## Context
The System category (theme, systemInline rows, About link) and Danger zone moved into `vendor/tauri_kit/frontend/settings/pages/system.ts` in this session. `root.ts` now only renders schema sections + a "System" nav row, but its `RootDeps` interface and imports still carry props that the page no longer uses:

- Imports unused: `Field` (from `../schema`), `DangerAction` (from `../renderer`), `ThemeValue` (from `./theme`).
- Interface props unused in render: `systemInline`, `dangerActions`, `current`, `theme`, `onChange`, `onThemeChange`, `onReset`, `onDanger`.

`renderer.ts` still passes those props to `rootPage(...)`. Removing them from `RootDeps` requires also removing them from the call site in `renderSettingsPage` (around the `stack.push(rootPage({...}))` block).

## Approach
1. In `vendor/tauri_kit/frontend/settings/pages/root.ts`:
   - Drop unused type imports.
   - Trim `RootDeps` to only what's rendered: `schema`, `onNavSection`, `onNavSystem`.
2. In `vendor/tauri_kit/frontend/settings/renderer.ts`, remove the now-unused props from the `rootPage({...})` call.
3. Run `npm test -- --run` in `vendor/tauri_kit` and `npm run build` at project root to verify.

## Acceptance
- `tsc`/vite build clean.
- All kit tests still pass.
- `RootDeps` lists only the props the render actually uses; `rootPage(...)` call in renderer matches.
