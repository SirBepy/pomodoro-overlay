# Split src-tauri/src/main.rs commands into commands.rs

## Goal

Extract all `#[tauri::command]` functions from `main.rs` into a dedicated `src-tauri/src/commands.rs` module to bring main.rs under 400 lines and separate IPC surface from platform setup.

## Context

After the 2026-05-04 session (logging + fullscreen module work), `src-tauri/src/main.rs` sits at ~419 lines. The file has a clean seam: lines 17-227 are exclusively `#[tauri::command]` fns (`get_settings`, `save_settings`, `set_window_size`, `open_settings_window`, `show_main_window`, `notify`, `pick_sound_file`, `start_resize`, `save_window_size`, `quit_app`, `get_corner_position`, `set_window_position`, `is_cursor_over_window`, `set_window_fullscreen`). The rest is platform helpers (`compute_corner_position`, `resize_and_anchor`, `apply_autostart`, `dimmed_icon`, `build_tray`, `main`).

## Approach

1. Create `src-tauri/src/commands.rs`
2. Move all `#[tauri::command]` fns into it; they need access to `Settings`, `SettingsState`, and the helper fns from main.rs
3. Make helpers (`compute_corner_position`, `resize_and_anchor`) `pub(crate)` in main.rs so commands.rs can call them
4. In main.rs: `mod commands;` + update `invoke_handler` to `tauri::generate_handler![commands::get_settings, ...]` (or re-export with `pub use`)
5. `cargo check` to verify

## Acceptance

- [ ] `main.rs` drops below 280 lines
- [ ] `commands.rs` exists and contains all 14 `#[tauri::command]` fns
- [ ] `cargo check` passes clean
- [ ] `npm run build` passes (no frontend impact expected)
