# Migrate claude_usage_in_taskbar to kit v2 (Phase 2)

## Goal
Migrate `claude_usage_in_taskbar` to consume `sirbepy_tauri_kit` v2's drill-in settings UI, replacing its hand-rolled router-based settings views. After migration, a bug fix in the kit's settings code reaches both pomodoro and claude_usage simultaneously.

## Context
Kit v1 (settings store + flat schema renderer) was built and shipped during the 2026-05-01 session. Kit v2 (drill-in nav, built-in About/Theme/Reset, design system) was built and shipped during the 2026-05-02 session. Pomodoro adopted v2 in the same session. Phase 2 — adopting v2 in claude_usage — was deferred because:
- claude_usage is the user's daily driver; rewriting it on day 1 of a new abstraction is risky
- claude_usage's settings UI is bigger surgery: multi-subview pattern (Visuals/Themes/Notifications), per-project overrides, sound packs, sidemenu nav
- Better to dogfood kit v2 in pomodoro for a few weeks first to surface API gaps

claude_usage location: `C:\Users\tecno\Desktop\Projects\claude_usage_in_taskbar`. Currently uses kit v1: `vendor/tauri_kit` submodule, `tauri_kit_settings::load_for/save_for` in Rust. Frontend uses lit-html + custom router (`src/router.ts`) with view modules under `src/views/`.

claude_usage's existing settings sections (each currently a separate router view):
- Visuals (`src/views/settings/subviews/visuals/visuals.ts`)
- Themes (`src/views/settings/subviews/themes/themes.ts`)
- Notifications (`src/views/settings/subviews/notifications/notifications.ts`)
- Settings root (`src/views/settings/settings.ts`) — shows version, Auto-Update select, Copy logs, logout. The "About" page concept claude_usage already has. Kit v2's About page should largely supersede this.

Spec for kit v2: `pomodoro-overlay/docs/superpowers/specs/2026-05-02-kit-v2-builtin-sections.md`.

## Approach
This is a real project, not a small task. Start with brainstorming + writing a spec. Don't dive into code.

**Phase A — discovery:**
- Read claude_usage's existing settings code top to bottom: `src/views/settings/**`, `src-tauri/src/settings/**`, `src-tauri/src/ipc/settings.rs`.
- Inventory every setting (top-level + per-subview). Map each to a kit v2 schema field or a `systemInline` row.
- Identify settings that don't fit kit v2's primitives: per-project overrides (`projectNotifOverrides[cwdKey][eventKey]`), sound pack picker, theme system (claude_usage has its own theming beyond kit's light/dark/system).
- Decide for each odd-shape setting: extend kit (add new field kind), use kit's `custom` field kind to render bespoke UI inline, or keep that area outside the kit.

**Phase B — spec:**
- Write `claude_usage_in_taskbar/docs/superpowers/specs/<date>-kit-v2-adoption.md`
- Cover: schema mapping, what stays bespoke (sound packs almost certainly do), how claude_usage's existing themes interact with kit's `__kit_theme` reserved key (potential conflict — claude_usage has 7+ named themes, kit has 3 modes; needs reconciliation)
- Decide on Settings shape: claude_usage currently uses an in-app route, not a separate window. Kit v2 supports both — pick which.

**Phase C — plan + execute:**
- Write implementation plan
- Subagent-driven execution

**Risks to design around:**
- Theme conflict: kit owns `__kit_theme` (light/dark/system). claude_usage owns `theme` (named themes like "ocean", "sunset"). Don't let migration silently overwrite the user's theme preference.
- `sound_path` and per-project overrides have non-trivial UIs. Kit's `custom` field kind is the escape hatch; verify it's expressive enough.
- claude_usage's settings.json has many more keys than pomodoro's. Make sure `KitSettings` flatten + serde defaults don't mangle anything on first load.

**Pre-flight:** before starting, dogfood kit v2 in pomodoro for at least a week. If kit v2 has discoverable rough edges, fix them in the kit before adopting in claude_usage.

## Acceptance
- [ ] claude_usage builds and runs unchanged from a user's perspective
- [ ] Settings file shape preserved — no setting loss on upgrade
- [ ] Drill-in nav replaces the previous multi-subview/sidemenu nav for the Settings area
- [ ] Built-in About / Theme / Reset pages function
- [ ] Sound pack picker still works (likely via `custom` field or kept bespoke)
- [ ] Per-project notification overrides still work
- [ ] Theme system reconciled — user's prior named theme is preserved or migrated explicitly with their consent
- [ ] No regressions in tray / dashboard / claude scraping flow (these are out of settings scope but verify)

## Verification commands
```
cd C:\Users\tecno\Desktop\Projects\claude_usage_in_taskbar
cargo test --workspace
npm test
cargo tauri build
```
