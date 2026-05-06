# Extract lib.rs from main.rs (Tauri lib+bin pattern)

## Goal

Move all non-entrypoint code from `src-tauri/src/main.rs` into `src-tauri/src/lib.rs`, leaving main.rs as a thin shim that calls `pomodoro_overlay::run()`. This matches the tauri spec structure and enables future unit testing of the setup logic.

## Context

During /bepy-project-setup migration this was identified as the correct long-term structure but deferred because it requires changing the crate target layout (adding a lib target) and could break the build if done wrong. The current main.rs is 265 lines and contains helper functions (`compute_corner_position`, `resize_and_anchor`, `apply_autostart`), tray setup (`build_tray`), and the full Tauri builder (`fn main`).

Prior plan from the migration session: move everything except `fn main` into lib.rs, change main.rs to just `fn main() { pomodoro_overlay::run(); }`, and make `run()` pub in lib.rs.

## Approach

1. Create `src-tauri/src/lib.rs`:
   - Move all `mod` declarations from main.rs
   - Move helper functions (compute_corner_position, resize_and_anchor, apply_autostart, dimmed_icon, build_tray)
   - Move the Tauri builder body into `pub fn run()`
   - Use `pub(crate)` for helpers; `pub fn run()` is the only public surface
2. Slim `src-tauri/src/main.rs` to:
   ```rust
   #![windows_subsystem = "windows"]
   fn main() {
       pomodoro_overlay::run();
   }
   ```
3. No Cargo.toml changes needed - Cargo auto-discovers lib.rs and main.rs as separate targets in the same crate.
4. Update any cross-module `use crate::` paths if the visibility changes.
5. Run `cargo check` to verify.

## Acceptance

- `cargo check` passes.
- `src-tauri/src/main.rs` is under 10 lines.
- `src-tauri/src/lib.rs` contains all setup logic and compiles as a lib target.
- App behavior unchanged (nothing functional moved, pure restructure).
