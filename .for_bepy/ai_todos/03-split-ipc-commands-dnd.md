# Split DnD logic out of ipc/commands.rs

## Goal

Extract the Windows DnD (Do Not Disturb) implementation from `src-tauri/src/ipc/commands.rs` into its own module `src-tauri/src/ipc/dnd.rs`, reducing commands.rs from 545 lines to ~380.

## Context

During /bepy-project-setup the structure was migrated to the tauri spec (commands.rs → ipc/commands.rs). The file is now 545 lines. The DnD implementation (the `dnd_impl` mod block + `recover_dnd_backup`, `enable_dnd`, `disable_dnd` commands, ~lines 5-186 + 491-545) is a self-contained Windows registry manipulation module with no dependencies on the rest of commands.rs other than `DndState` and `dnd_backup_path`.

The split was flagged but not done because it would have been scope creep during the structure migration.

## Approach

1. Create `src-tauri/src/ipc/dnd.rs` with:
   - `mod dnd_impl` (the Windows registry blob manipulation code)
   - `dnd_backup_path()` helper
   - `pub(crate) fn recover_dnd_backup(blob: &[u8]) -> bool`
   - `#[tauri::command] pub fn enable_dnd(...)` and `pub fn disable_dnd(...)`
2. In `src-tauri/src/ipc.rs`, add `pub mod dnd;`
3. In `src-tauri/src/ipc/commands.rs`, remove the dnd_impl block and the three functions. Update the use statement if anything from dnd.rs is needed.
4. In `src-tauri/src/main.rs`, update invoke_handler to import `dnd::enable_dnd` and `dnd::disable_dnd` from `ipc::dnd`, and `ipc::commands::recover_dnd_backup` → `ipc::dnd::recover_dnd_backup`.
5. Run `cargo check` to verify.

## Acceptance

- `cargo check` passes with no errors.
- `src-tauri/src/ipc/commands.rs` is under 400 lines.
- DnD enable/disable/recover all work (verify by grepping that the tauri::command attributes are present in dnd.rs).
- No behavior changes - this is pure structural refactor.
