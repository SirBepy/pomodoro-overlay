# Remove unused `expanded` parameter from set_window_size

## Goal
Drop the dead `expanded: bool` parameter from the `set_window_size` Tauri command in `src-tauri/src/ipc/commands.rs`.

## Context
`src-tauri/src/ipc/commands.rs:33` defines `pub fn set_window_size(app: AppHandle, expanded: bool)`. Line 39 immediately discards it: `let _ = expanded;`. The command body always uses `settings.expanded_size()` regardless of the flag — it's a relic from when collapsed/expanded modes existed.

Frontend caller: `src/main.ts:373` invokes `set_window_size` with `{ expanded: true }`. Single call site.

## Approach
1. Remove `expanded: bool` from the Rust signature; remove the `let _ = expanded;` line.
2. Update the JS call in `src/main.ts:373` to drop the `{ expanded: true }` payload.
3. Verify `cargo check` passes and the `settings-reset` listener still resets the window size correctly.

## Acceptance
- Rust signature is `pub fn set_window_size(app: AppHandle) -> Result<(), String>`.
- No `expanded` arg passed from JS.
- App still resizes back to configured size on settings reset.
