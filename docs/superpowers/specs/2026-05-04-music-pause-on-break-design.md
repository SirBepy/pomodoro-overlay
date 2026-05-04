# Music Pause on Break - Design

## Goal

When the break timer starts, pause any playing media (Spotify, YouTube Music in browser, etc.) using Windows SMTC. When the focus timer starts again, resume only the sessions the app paused. A settings toggle controls the feature.

## Trigger Points

- **Pause:** inside `startTimer()` in `app.js`, when `phase` is `short` or `long`
- **Resume:** inside `startTimer()` in `app.js`, when `phase` is `PHASE_WORK` and `musicPausedByApp === true`

This covers both automatic phase transitions and manual tab switches + Start click.

## Architecture

### Rust - two new Tauri commands in `main.rs`

**`media_pause_if_playing() -> bool`** (async)
1. Get `GlobalSystemMediaTransportControlsSessionManager::RequestAsync()`
2. Iterate `GetSessions()`
3. For each session with `GetPlaybackInfo().PlaybackStatus == Playing`:
   - Call `TryPauseAsync()`
   - Store `SourceAppUserModelId()` in managed `Mutex<Vec<String>>` state (`PausedSessionsState`)
4. Return `true` if any sessions were paused

**`media_resume()`** (async)
1. Read stored app IDs from `PausedSessionsState`
2. Get fresh SMTC session list
3. For each stored ID, find the matching session and call `TryPlayAsync()`
4. Clear the stored list

**State:**
```rust
struct PausedSessionsState(Mutex<Vec<String>>);
```
Managed as a Tauri state resource. Not persisted - app restart clears it.

**Cargo.toml additions:**
```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
  "Media_Control",
  "Foundation_Collections",
] }
```

### JS - `app.js`

New module-level flag:
```js
let musicPausedByApp = false;
```

In `startTimer()`, after the existing guard:
```js
if (settings?.pause_music_on_break) {
  if (phase === PHASE_WORK && musicPausedByApp) {
    invoke("media_resume").catch(() => {});
    musicPausedByApp = false;
  } else if (phase === PHASE_SHORT || phase === PHASE_LONG) {
    const paused = await invoke("media_pause_if_playing").catch(() => false);
    if (paused) musicPausedByApp = true;
  }
}
```

### Settings

New field in `schema.ts`, Sound section:
```ts
{ key: "pause_music_on_break", kind: "toggle", label: "Pause music on break" }
```

New field in `settings.rs` `Settings` struct:
```rust
#[serde(default)]
pub pause_music_on_break: bool,
```

## Error Handling

All SMTC calls are fire-and-forget (`.catch(() => {})`). If a session disappears between pause and resume, skip it silently. No user-visible error states.

## Out of Scope

- Spotify Web API / OAuth
- Pausing media on phase switch without starting timer
- Persisting `musicPausedByApp` across app restarts

## Acceptance

- Enabling toggle + starting break timer pauses Spotify
- Enabling toggle + starting break timer pauses YouTube Music in Chrome/Edge
- Starting focus timer resumes only what the app paused (not new sessions started during break)
- If music was already paused when break starts, nothing changes on focus resume
- Disabling the toggle: no pause/resume calls made at all
- `cargo build` passes with no new warnings
