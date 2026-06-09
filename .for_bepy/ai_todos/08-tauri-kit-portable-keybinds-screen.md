# tauri-kit: portable keybinds screen (plug into any project)

## Goal

Promote PomodoroOverlay's keybinds screen into tauri-kit as a reusable, scalable component: UI + key-capture + conflict detection + persistence wiring, so any kit app adds a keybinds screen by supplying only schema fields + Rust defaults. Then migrate PomodoroOverlay to consume it and delete the local dupes.

## Status

DESIGNED, not implemented. Full design below (produced by a read-only Plan pass on 2026-06-09). Deferred mid-autopilot to fix release-breaking timer bugs first. Ready for a focused implementation session - hand the ordered step list to an implementer.

## Context (anchored to real files)

Local prototype (PomodoroOverlay):
- `src/views/settings/keybind-field.ts` - factory `keybindField()` (line 76) returning a `CustomField` (`kind:"custom"`). Core: `codeToAccelerator()` (l17), `buildAccelerator(e)` (l32, exported, the only unit tested), `startCapture()` (l47, global keydown capture + Escape-cancel + blur-stop). `render()` (l82) draws label + badge + Record/Clear.
- `src/views/settings/keybind-field.css` - `.keybind-row`, `.keybind-badge`, `.keybind-record-btn.recording`.
- `src/views/settings/__tests__/keybind-field.test.ts` - ONLY locks `buildAccelerator` (7 cases). No coverage of startCapture/conflict/render.
- Wired in `src/views/settings/schema.ts`: `keybindField({key,label})` x4 (l281 meeting toggle; l352-354 pause/skip/show_hide). Keys are flat top-level settings keys.
- Persistence: kit `renderer.ts setField()` (l110) writes `current[key]=value`, `invoke("save_settings",{settings:current})`, emits `settings-updated`. NO parallel keybind store - keybinds are plain string settings.

Rust:
- `src-tauri/src/settings.rs` - `Settings` holds `keybind_pause/skip/show_hide` (l34-36) + `keybind_meeting_toggle` (l43), all `Option<String>`, default `None` (l86-88,95). `#[serde(default)]` (l7) => missing key resets to None (the "schema.ts AND Rust struct+Default" rule).
- `src-tauri/src/ipc/commands.rs save_settings` (l16) diffs old/new keybinds, calls `hotkeys::register_hotkeys` (l63).
- `src-tauri/src/hotkeys.rs register_hotkeys` (l12) - FIXED positional args per action; dedups combos via HashSet (l35, silent "first wins"); emits `hotkey-pause`/`hotkey-skip`/`hotkey-meeting-toggle` or calls `toggle_main_visibility`. Frontend consumes in `src/main.ts` (l457) + `src/views/timer/window-events.ts`.

Conflict detection DOES NOT EXIST in the frontend today. Only Rust-side silent "first wins" (invisible to user). Closing this gap is the main value-add of the promotion.

Kit field architecture:
- `vendor/tauri_kit/frontend/settings/schema.ts` - `Field` union (l66); `CustomField` (l58) already exists (structurally identical to local KeybindFieldDef).
- `vendor/tauri_kit/frontend/settings/fields.ts fieldRow` switch (l27); `case "custom"` (l163) calls `field.render(value,onChange)`. Built-in kinds (number/select/toggle/text/file/range) each = typed interface in schema.ts + case in fields.ts + CSS in styles/components.css. That's the new-field-type pattern.
- `vendor/tauri_kit/frontend/settings/pages/section.ts renderFields` (l13) applies visibleWhen then fieldRow; has `current` in scope (passes `current[f.key]` at l15).
- Tests: `cd vendor/tauri_kit; npm test` (vitest jsdom, `frontend/**/*.test.ts`).

## Approach (DESIGN FORK resolved)

Two options: (A) native kit field type `kind:"keybind"` vs (B) standalone keybinds-screen component taking `KeybindAction[]`.

DECISION: Hybrid - native `kind:"keybind"` field (Option A mechanics) + conflict detection fed the full `current` map. Rationale: the kit's value is the schema-driven field model; a standalone screen fights it. Keybinds-as-fields get visibleWhen/tooltips/existing save path free, and can live across multiple sections (today they're in two). The "list of actions + defaults" contract = schema field list + Rust defaults (defaults MUST live in Rust per the reset rule, not a frontend config). Solve the one real gap (cross-row conflict visibility) by threading `current` into ONLY the keybind case.

Config contract a consumer writes (data, not a constructor call):
`{ key:"keybind_pause", kind:"keybind", label:"Pause / Resume", tooltip?:string }`
Defaults live in Rust `Settings::default()`. Render = label + badge(accelerator or "Not set") + Record + Clear. Capture = the promoted startCapture/buildAccelerator/codeToAccelerator (behavior locked by the migrated test). Conflict = scan sibling keybind keys in `current` for a matching accelerator; show a conflict class on the badge (display-only, saving still fires - Rust "first wins" stays authoritative so the user can deliberately rebind). Return path unchanged: `onChange(acc)` -> `setField` -> `save_settings`. No new command/store.

Rust: NO kit Rust change. Keybinds stay plain `Option<String>` in the app's Settings. Generalizing `hotkeys.rs register_hotkeys` (positional args -> `Vec<(combo,event)>`) is a SEPARATE larger task (it calls app-specific `crate::toggle_main_visibility`) - explicitly out of scope here.

## Ordered steps

(A) Kit-side - `vendor/tauri_kit`:
1. Add `KeybindField` interface + union member to `frontend/settings/schema.ts`.
2. New file `frontend/settings/fields/keybind.ts` - move `codeToAccelerator`/`buildAccelerator`/`startCapture` from the app; add `findKeybindConflict(current,fields,key)` + `keybindFieldRow(field,value,current,onChange)`.
3. Add `case "keybind"` to `frontend/settings/fields.ts`; extend `fieldRow(field,value,onChange,current?)`; pass `current` from `pages/section.ts renderFields` (l15). Only keybind case reads it; others ignore (backward compatible - existing tests call sectionPage/renderSettingsPage, not fieldRow directly; grep for other `fieldRow(` callers first).
4. Add `.kit-keybind-row/.kit-keybind-badge/.kit-keybind-badge--conflict/.kit-keybind-record-btn.recording` to `frontend/settings/styles/components.css` (kit- prefix; styles.css already pulls components.css).
5. New file `frontend/settings/fields/keybind.test.ts` - migrated buildAccelerator cases + conflict cases + a render-row test (badge text + conflict class). VERIFY: `cd vendor/tauri_kit; npm test` all green.
6. Commit submodule FIRST (before parent pointer).

(B) PomodoroOverlay migration:
7. `src/views/settings/schema.ts`: replace 4 `keybindField(...)` with `{key,kind:"keybind",label}`; drop the import (l2).
8. Delete `keybind-field.ts`, `keybind-field.css`, `__tests__/keybind-field.test.ts` (coverage moved to kit).
9. Bump submodule pointer to step-6 commit. VERIFY: `npm run build` (typechecks schema vs kit's new KeybindField) + `npx vitest run`.
10. Manual smoke: bind two actions to same chord -> conflict badge shows; restart -> bindings persist (Rust default round-trip).

## Acceptance

- A consuming app adds a full keybinds screen by writing schema fields + Rust defaults only.
- PomodoroOverlay uses the kit version; local keybind-field files deleted; buildAccelerator coverage preserved in the kit.
- Conflict detection visible (two actions, same chord -> user sees it; saving not blocked).
- `cd vendor/tauri_kit; npm test` green; PomodoroOverlay `npm run build` + `npx vitest run` green.
- Ready to plug into claude_usage_in_taskbar with the same contract.

## Risks / sharp edges

- Submodule must be committed + parent pointer bumped, or parent resolves old kit. Build/test kit in isolation first, then bump.
- Reset-on-restart rule: reusing existing keybind_* keys keeps it satisfied; any NEW keybind action a consumer adds MUST add the Rust field + Default. Put this in the kit field's doc comment.
- lit-html select rule (`?selected=` per option, not `.value=`) - not triggered now (buttons/badges), but applies if a dropdown is ever added.
- applyTheme-on-new-route: keybinds render inside the existing settings stack (no new route) - do NOT add an applyTheme call.
- `fieldRow` signature change is backward-compatible only if all callers updated; sole caller is `section.ts` l15 - grep to confirm before changing.
- Global keydown capture leak: preserve `startCapture`'s `stop()` cleanup incl. the `document.contains(btn)` guard (l65) - the kit re-renders the whole page on every setField, so a button can detach mid-capture.
- Conflict detection is DISPLAY-ONLY: must not block saving or alter the stored value.
- Port the field KIND, not the factory function - consumers write data, not call `keybindField()`. This is what makes it scalable.
