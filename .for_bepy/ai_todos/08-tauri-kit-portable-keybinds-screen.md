# tauri-kit: portable keybinds screen (plug into any project)

## Goal

Promote the keybinds screen into tauri-kit as a reusable, scalable component: UI + capture/binding functionality + persistence wiring, so it drops into PomodoroOverlay, ClaudeUsage, and future projects with minimal glue.

## Context

- PomodoroOverlay already has a project-local keybind field: `src/views/settings/keybind-field.ts` + `keybind-field.css` (and tests in `src/views/settings/__tests__/keybind-field.test.ts`). This is the prototype to generalize.
- tauri-kit settings live in `vendor/tauri_kit/frontend/settings/` with a schema-driven field renderer (`fields.ts`, `renderer.ts`, `schema.ts`).
- Goal is scalability: each project supplies its list of bindable actions + defaults; tauri-kit owns the capture UI, conflict detection, and rendering.

## Approach

1. Extract the keybind capture logic + UI from PomodoroOverlay's `keybind-field.ts` into a tauri-kit component (e.g. a new field type in `vendor/tauri_kit/frontend/settings/`).
2. Define a config contract: consuming project passes an array of `{ actionId, label, defaultBinding }`; component renders rows, captures key chords, detects conflicts, returns bindings via the existing settings save path.
3. Persist through the existing tauri-kit settings layer (don't invent a new store).
4. Migrate PomodoroOverlay to consume the kit component; delete the now-duplicated local files.
5. Keep it framework-consistent: lit-html templates only, no React/Vue.

## Acceptance

- A project can add a full keybinds screen by supplying only its action list + defaults.
- PomodoroOverlay uses the kit version; local keybind-field files removed; keybind tests pass against the kit component.
- Conflict detection works (two actions can't bind the same chord silently).
- Ready to plug into ClaudeUsage with the same contract.
