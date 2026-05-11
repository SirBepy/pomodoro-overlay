# Extract THEME_OPTIONS to a shared module

## Goal
Single source of truth for theme select options shared between `system.ts` and any other consumer (currently `theme.ts` has a similar list).

## Context
`vendor/tauri_kit/frontend/settings/pages/system.ts` defines:
```ts
const THEME_OPTIONS: { value: ThemeValue; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
```
`pages/theme.ts` exports a similar `VALID` array of the same string values. The pre-extract version of `root.ts` had the identical `THEME_OPTIONS` constant, which is why it was carried into `system.ts`.

## Approach
1. Move `THEME_OPTIONS` (with `value` + `label`) into `vendor/tauri_kit/frontend/settings/pages/theme.ts` as a named export.
2. Import in `system.ts`; remove the local copy.
3. If `VALID` in `theme.ts` only validates string values, derive it from `THEME_OPTIONS.map(o => o.value)` to avoid double-listing values.
4. Re-run kit tests.

## Acceptance
- One declared list of theme values across the kit.
- All system + theme tests still pass.
