# Split kit's settings/styles.css

## Goal
Split `sirbepy_tauri_kit/frontend/settings/styles.css` (currently 433 lines) into multiple smaller files organized by concern, so each file is focused and easier to scan.

## Context
During the 2026-05-02 kit v2 build, `styles.css` grew from a placeholder (~20 lines) to 433 lines covering: theme variables, reset, root container, page stack/slide, headers, sections, rows + nav rows, inputs, toggle, file picker, buttons, about hero, developer links, theme picker cards, modal, tooltip.

The file is monolithic. There's a clear seam: themes/reset (the design tokens), structural primitives (rows, headers, sections), reusable components (buttons, toggle, inputs, tooltip, file picker), feature-specific styles (about hero, theme cards, modal, dev block).

This isn't urgent — the file works fine — but every future kit feature will keep growing it. Better to split now while the seam is obvious.

## Approach
1. Create `frontend/settings/styles/` directory.
2. Split into 4 files:
   - `tokens.css` — `:root`/`[data-theme]` blocks + html/body reset (the CSS variable definitions)
   - `structure.css` — `.kit-settings`, `.kit-stack`, `.kit-page`, `.kit-header*`, `.kit-section*`, `.kit-row*`, `.kit-nav-arrow`
   - `components.css` — `.kit-input`, `.kit-select`, `.kit-range`, `.kit-toggle*`, `.kit-file-row`, `.kit-file-display`, `.kit-btn-*`, `.kit-tooltip-*`
   - `features.css` — `.kit-about-*`, `.kit-dev-*`, `.kit-theme-cards`, `.kit-theme-card*`, `.kit-theme-swatch*`, `.kit-modal*`
3. Replace `frontend/settings/styles.css` content with `@import` statements:
   ```css
   @import url("./styles/tokens.css");
   @import url("./styles/structure.css");
   @import url("./styles/components.css");
   @import url("./styles/features.css");
   ```
4. Verify via `npm run build` in pomodoro that the bundled CSS is identical (or at least visually equivalent — Vite's CSS handling resolves `@import` at build time).
5. Bump kit minor.

Alternative: have consumers import each file directly instead of through `styles.css`. More flexible (apps can opt out of feature CSS) but breaks the single-import contract pomodoro currently uses. Stick with the `styles.css` re-export.

## Acceptance
- [ ] All 4 files created, each under 150 lines
- [ ] `styles.css` is a thin index file (~6 lines)
- [ ] Pomodoro `npm run build` succeeds
- [ ] Visual rendering of pomodoro settings UI is unchanged after rebuild
- [ ] Kit `npm test` passes (no test should depend on file paths)

## Verification commands
```
cd C:\Users\tecno\Desktop\Projects\sirbepy_tauri_kit
npm test

cd C:\Users\tecno\Desktop\Projects\pomodoro-overlay
npm run build
npm run tauri dev
# Open settings, eyeball every page, confirm no styling regressions
```
