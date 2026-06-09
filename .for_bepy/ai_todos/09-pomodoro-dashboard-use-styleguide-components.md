# PomodoroOverlay dashboard: adopt tauri-kit styleguide components

## Goal

The PomodoroOverlay dashboard UI appears to roll its own styling instead of using the components/tokens defined in the tauri-kit styleguide. Align it so the dashboard uses kit components/tokens for visual consistency.

## Context

- Dashboard files: `src/views/dashboard/` (dashboard.ts, summary-strip.ts, breakdown.ts, day-view.ts, sessions-screen.ts, legend.ts, pie.ts, etc.).
- tauri-kit styleguide/components: `vendor/tauri_kit/frontend/styleguide/` (themes) and the shared component styles in `vendor/tauri_kit/frontend/settings/styles/` (`components.css`, `tokens.css`) exposing `kit-*` classes and design tokens.
- Suspicion (to verify first): dashboard uses ad-hoc CSS/colors rather than kit tokens/classes. Note `src/views/dashboard/phase-colors.ts` must still mirror base.css `.phase-*` `--bg` (existing rule - don't break phase color sourcing).

## Approach

1. Audit `src/views/dashboard/*` styling vs the kit styleguide: list where it uses custom CSS/colors instead of kit tokens/components.
2. Replace ad-hoc spacing/color/typography with kit tokens (`tokens.css`) and reuse kit component classes where a matching component exists.
3. Keep phase colors sourced from base.css `--bg` per existing convention; don't invent a new palette.
4. Verify visually in the running app (Tauri webview - manual QA, Playwright can't reach it).

## Acceptance

- Dashboard visual styling driven by kit tokens/components, not duplicated ad-hoc CSS.
- Phase colors still match base.css `.phase-*`.
- `npm run build` passes; dashboard tests in `src/views/dashboard/__tests__/` pass.
- Joe confirms the dashboard looks consistent with the rest of the kit-styled UI.
