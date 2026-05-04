# Music Pause on Break - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the break timer starts, pause any playing SMTC media (Spotify, YouTube Music in browser); when the focus timer starts, resume only what the app paused.

**Architecture:** Two async Tauri commands (`media_pause_if_playing`, `media_resume`) use Windows SMTC WinRT APIs to pause/resume specific sessions tracked by source app ID in Rust managed state. A JS flag gates resume calls. A settings toggle controls the whole feature.

**Tech Stack:** Rust (windows crate 0.58, WinRT Media.Control), Tauri 2.x, JS (app.js)

---

## File Map

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `windows` crate with `Media_Control` + `Foundation_Collections` features |
| `src-tauri/src/settings.rs` | Add `pause_music_on_break: bool` field + default |
| `src-tauri/src/main.rs` | Add `PausedSessionsState`, two commands, register in invoke_handler |
| `src/settings/schema.ts` | Add toggle in Sound section |
| `src/app.js` | Add `musicPausedByApp` flag, make `startTimer` async, add music logic |

---

### Task 1: Add `windows` crate to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the windows crate under the existing windows-only target block**

In `src-tauri/Cargo.toml`, the current windows-only block (lines 22-24) is:
```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows-sys = { version = "0.61", features = ["Win32_UI_WindowsAndMessaging", "Win32_UI_Input_KeyboardAndMouse", "Win32_Foundation"] }
raw-window-handle = "0.6"
```

Replace it with:
```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows-sys = { version = "0.61", features = ["Win32_UI_WindowsAndMessaging", "Win32_UI_Input_KeyboardAndMouse", "Win32_Foundation"] }
raw-window-handle = "0.6"
windows = { version = "0.58", features = ["Media_Control", "Foundation_Collections"] }
```

- [ ] **Step 2: Verify it resolves**

```powershell
cargo fetch --manifest-path src-tauri/Cargo.toml
```

Expected: exits 0, downloads windows 0.58 crate. No errors.

- [ ] **Step 3: Commit**

Run `/commit` skill. Message: `CHORE: add windows crate for SMTC media control`

---

### Task 2: Add `pause_music_on_break` to settings

**Files:**
- Modify: `src-tauri/src/settings.rs`
- Modify: `src/settings/schema.ts`

- [ ] **Step 1: Add field to Settings struct**

In `src-tauri/src/settings.rs`, in the `Settings` struct (after `fullscreen_on_focus_end`, before `#[serde(flatten)]`):
```rust
    pub pause_music_on_break: bool,
```

- [ ] **Step 2: Add default value**

In `impl Default for Settings`, in the `Self { ... }` block (after `fullscreen_on_focus_end: false,`):
```rust
            pause_music_on_break: false,
```

- [ ] **Step 3: Add toggle to schema.ts**

In `src/settings/schema.ts`, in the Sound section fields array (after the `sound_path` file field):
```ts
        { key: "pause_music_on_break", kind: "toggle", label: "Pause music on break" },
```

- [ ] **Step 4: Verify compile**

```powershell
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: compiles clean, no errors or new warnings.

- [ ] **Step 5: Commit**

Run `/commit` skill. Message: `FEAT: add pause_music_on_break setting`

---

### Task 3: Implement Rust SMTC commands

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add PausedSessionsState struct**

At the top of `src-tauri/src/main.rs`, after the existing `use` block and before the first `#[tauri::command]` (around line 17), add:

```rust
// Always defined so State<PausedSessionsState> compiles on all platforms.
// SMTC calls inside the commands are gated by #[cfg(target_os = "windows")].
struct PausedSessionsState(std::sync::Mutex<Vec<String>>);
```

- [ ] **Step 2: Implement media_pause_if_playing command**

Add after the `is_cursor_over_window` command (around line 229):

```rust
#[tauri::command]
async fn media_pause_if_playing(state: State<'_, PausedSessionsState>) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Media::Control::{
            GlobalSystemMediaTransportControlsSessionManager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        };

        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;

        let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
        let count = sessions.Size().map_err(|e| e.to_string())?;
        let mut paused_ids: Vec<String> = Vec::new();

        for i in 0..count {
            if let Ok(session) = sessions.GetAt(i) {
                if let Ok(info) = session.GetPlaybackInfo() {
                    if let Ok(status) = info.PlaybackStatus() {
                        if status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
                            if let Ok(op) = session.TryPauseAsync() {
                                let _ = op.await;
                            }
                            if let Ok(id) = session.SourceAppUserModelId() {
                                paused_ids.push(id.to_string());
                            }
                        }
                    }
                }
            }
        }

        let had_any = !paused_ids.is_empty();
        *state.0.lock().unwrap() = paused_ids;
        return Ok(had_any);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Ok(false)
    }
}
```

- [ ] **Step 3: Implement media_resume command**

Add directly after `media_pause_if_playing`:

```rust
#[tauri::command]
async fn media_resume(state: State<'_, PausedSessionsState>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

        let ids: Vec<String> = {
            let mut guard = state.0.lock().unwrap();
            std::mem::take(&mut *guard)
        };

        if ids.is_empty() {
            return Ok(());
        }

        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;

        let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
        let count = sessions.Size().map_err(|e| e.to_string())?;

        for i in 0..count {
            if let Ok(session) = sessions.GetAt(i) {
                if let Ok(id) = session.SourceAppUserModelId() {
                    if ids.contains(&id.to_string()) {
                        if let Ok(op) = session.TryPlayAsync() {
                            let _ = op.await;
                        }
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = state;
    Ok(())
}
```

- [ ] **Step 4: Register PausedSessionsState in setup()**

In `main()`, in the `.setup(|app| { ... })` block, after `handle.manage(SettingsState(Mutex::new(settings)));` (around line 394):

```rust
            handle.manage(PausedSessionsState(std::sync::Mutex::new(Vec::new())));
```

- [ ] **Step 5: Register commands in invoke_handler**

In `.invoke_handler(tauri::generate_handler![...])`, add both commands to the list:

```rust
            media_pause_if_playing,
            media_resume,
```

- [ ] **Step 6: Verify compile**

```powershell
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: compiles clean. If you see `unused import` warnings on non-Windows, add `#[allow(unused_imports)]` locally. No functional errors expected.

- [ ] **Step 7: Commit**

Run `/commit` skill. Message: `FEAT: add SMTC media_pause_if_playing and media_resume commands`

---

### Task 4: Wire music pause/resume into startTimer() in app.js

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add musicPausedByApp flag**

In `src/app.js`, after `let counter = 1;` (line 30), add:

```js
let musicPausedByApp = false;
```

- [ ] **Step 2: Make startTimer async and add music logic**

Replace the current `startTimer` function (lines 133-142):

```js
function startTimer() {
  if (running) return;
  // Exiting to focus: restore original window size
  if (phase === PHASE_WORK && fsState.isOverlayFullscreen) {
    exitOverlayFullscreen();
  }
  running = true;
  tickHandle = setInterval(tick, 1000);
  render();
}
```

With:

```js
async function startTimer() {
  if (running) return;
  if (phase === PHASE_WORK && fsState.isOverlayFullscreen) {
    exitOverlayFullscreen();
  }
  if (settings?.pause_music_on_break) {
    if (phase === PHASE_WORK && musicPausedByApp) {
      invoke("media_resume").catch(() => {});
      musicPausedByApp = false;
    } else if ((phase === PHASE_SHORT || phase === PHASE_LONG) && !musicPausedByApp) {
      const paused = await invoke("media_pause_if_playing").catch(() => false);
      if (paused) musicPausedByApp = true;
    }
  }
  running = true;
  tickHandle = setInterval(tick, 1000);
  render();
}
```

- [ ] **Step 3: Also clear the flag on settings-reset**

In the `settings-reset` event listener (around line 403), after `fsState.snoozeCount = 0;`, add:

```js
    musicPausedByApp = false;
```

- [ ] **Step 4: Build the full app to verify**

```powershell
cargo tauri build --debug --manifest-path src-tauri/Cargo.toml
```

Expected: debug build succeeds, no errors.

- [ ] **Step 5: Commit**

Run `/commit` skill. Message: `FEAT: pause/resume music on break/focus via SMTC`

---

### Task 5: Manual smoke test

- [ ] **Step 1: Run the debug build**

```powershell
cargo tauri dev
```

- [ ] **Step 2: Test Spotify**

  1. Open Spotify, play a song
  2. In settings, enable "Pause music on break"
  3. Set work timer to 1 minute, enable auto-start break
  4. Start the timer and wait for focus to end (or use Skip)
  5. Expected: Spotify pauses when the break timer starts
  6. Wait for break to end (or Skip)
  7. Expected: Spotify resumes when focus timer starts

- [ ] **Step 3: Test YouTube Music**

  1. Open YouTube Music in Chrome or Edge, play a song
  2. Repeat steps 3-7 above
  3. Expected: same pause/resume behavior

- [ ] **Step 4: Test "did we pause it" flag**

  1. Manually pause Spotify before starting the break timer
  2. Start break timer
  3. Expected: Spotify stays paused (nothing happens - it wasn't Playing when we checked)
  4. Start focus timer
  5. Expected: Spotify stays paused (musicPausedByApp was false, no resume call)

- [ ] **Step 5: Test toggle off**

  1. Disable "Pause music on break" in settings
  2. Play Spotify, start a break timer
  3. Expected: music is NOT paused

- [ ] **Step 6: Commit any fixes found during testing**

Run `/commit` skill for any follow-up fixes.
