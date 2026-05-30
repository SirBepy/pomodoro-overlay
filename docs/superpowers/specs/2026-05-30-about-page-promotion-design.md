# Design: Promote About to Root Nav + Relocate Reset Field

**Date:** 2026-05-30

## Summary

Two changes:
1. Promote the About page from nested under System to a top-level nav item.
2. Move "Reset session progress on launch" from the System inline fields into the Timer > Behavior group.

## Motivation

About is a frequently accessed page (version info, update check). Burying it two levels deep (Settings > System > About) is unnecessary friction. Flattening it to Settings > About improves discoverability.

"Reset session progress on launch" is timer behavior, not a system/OS setting. The System page is cleaner without it, and it groups logically with auto-start and editable-when-paused.

## Root Nav Restructure

**New root nav structure:**

```
Pomodoro   Timer / Focus mode / Meeting mode
Preferences  Overlay / Sound / Keybinds
General    Stats / System / About         <- "Data" renamed, About added
```

About appears after System in the General group.

### Files changed in vendor/tauri_kit:

**`frontend/settings/pages/root.ts`**
- Rename category label `"Data"` to `"General"`.
- Add `onNavAbout: () => void` to `RootDeps` interface.
- In the last category block, append `navRow("About", "about", deps.onNavAbout)` after System.
- In the empty-schema fallback block, also add the About nav row.

**`frontend/settings/pages/system.ts`**
- Remove `onNavAbout: () => void` from `SystemPageDeps` interface.
- Remove `${navRow("About", "about", deps.onNavAbout)}` from the template.

**`frontend/settings/renderer.ts`**
- In `rootPage({...})` call: add `onNavAbout: navAboutSync`.
- In `systemPage({...})` call: remove `onNavAbout: navAboutSync`.

### Tests changed in vendor/tauri_kit:

**`frontend/settings/pages/system.test.ts`**
- Remove `onNavAbout: () => {}` from `defaultDeps`.
- Delete the test `"clicking About calls onNavAbout"`.

**`frontend/settings/pages/root.test.ts`**
- Add `onNavAbout: () => {}` to `defaultDeps`.
- Update the nav-row count test: 2 schema sections + System + About = 4 rows.
- Add test: `"clicking About nav-row calls onNavAbout"`.
- Update `"System nav-row appears even with empty schema"` to also assert About nav-row appears.

## Field Relocation

**`src/views/settings/schema.ts`**

Move `reset_on_restart` from `systemInline` into the Timer > Behavior group, after `editable_when_paused`:

```ts
{
  key: "reset_on_restart",
  kind: "toggle",
  label: "Reset session progress on launch",
  tooltip: "When on, every app launch starts at session 1. When off, your previous unfinished session resumes.",
}
```

After the move, `systemInline` contains only:

```ts
export const systemInline = [
  {
    key: "autostart",
    kind: "toggle" as const,
    label: "Launch at startup",
    tooltip: "Run the overlay automatically when Windows starts.",
  },
];
```

No Rust changes needed - `settings.rs` already has both fields in the struct. No schema field type change.

## Non-changes

- `about.ts` is unchanged - its deps are already generic and project-agnostic.
- `settings.rs` struct is unchanged.
- No new packages or dependencies.
- No persistence behavior changes.

## Templates opinion

`system.ts` and `about.ts` are already importable functions with injected deps - they are already templates. With `reset_on_restart` removed from systemInline, no Pomodoro-specific fields leak into the System page deps. No additional "template system" work is needed; server_supervisor can import these pages directly when it needs them.
