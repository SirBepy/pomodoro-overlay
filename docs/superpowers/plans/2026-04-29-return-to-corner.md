# Return-to-Corner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a setting so the overlay window animates back to its configured corner after the user drags it, after a configurable number of seconds (0 = never).

**Architecture:** New `return_to_corner_seconds: u32` field in Settings. Two new Tauri commands: `get_corner_position` (returns target `{x, y}` for the current corner) and `set_window_position` (moves the window to absolute coords). JS in `app.js` listens to window move events, starts/resets a countdown, then lerps the window back over ~400ms.

**Tech Stack:** Rust (Tauri v2), vanilla JS, Tauri IPC commands

---

### Task 1: Add setting to Rust

**Files:**
- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Add field to Settings struct**

In `src-tauri/src/settings.rs`, add the field after `auto_advance`:

```rust
pub return_to_corner_seconds: u32,
```

So the struct reads:
```rust
pub auto_advance: bool,
pub return_to_corner_seconds: u32,
```

- [ ] **Step 2: Add default value**

In the `Default` impl, add after `auto_advance: true,`:
```rust
return_to_corner_seconds: 0,
```

- [ ] **Step 3: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src-tauri/src/settings.rs
git commit -m "feat: add return_to_corner_seconds setting field"
```

---

### Task 2: Add Tauri commands for position control

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add `get_corner_position` command**

After the `pick_sound_file` command (around line 93), add:

```rust
#[tauri::command]
fn get_corner_position(app: AppHandle) -> Result<(i32, i32), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let s = app.state::<SettingsState>();
    let settings = s.0.lock().unwrap().clone();
    let (w, h) = settings.expanded_size();
    let monitor = win
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(win.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or_else(|| "no monitor".to_string())?;
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let pos = monitor.position();
    let margin = (16.0 * scale) as i32;
    let mw = size.width as i32;
    let mh = size.height as i32;
    let mx = pos.x;
    let my = pos.y;
    let (x, y) = match settings.corner.as_str() {
        "tl" => (mx + margin, my + margin),
        "tr" => (mx + mw - w as i32 - margin, my + margin),
        "bl" => (mx + margin, my + mh - h as i32 - margin),
        _ => (mx + mw - w as i32 - margin, my + mh - h as i32 - margin),
    };
    Ok((x, y))
}
```

- [ ] **Step 2: Add `set_window_position` command**

Directly after the `get_corner_position` command, add:

```rust
#[tauri::command]
fn set_window_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Register both commands in invoke_handler**

In `main()`, update the `invoke_handler` macro to include the two new commands:

```rust
.invoke_handler(tauri::generate_handler![
    get_settings,
    save_settings,
    set_window_size,
    open_settings_window,
    notify,
    pick_sound_file,
    quit_app,
    get_corner_position,
    set_window_position,
])
```

- [ ] **Step 4: Verify compile**

Run: `cd src-tauri && cargo check`
Expected: no errors

- [ ] **Step 5: Commit**

```
git add src-tauri/src/main.rs
git commit -m "feat: add get_corner_position and set_window_position commands"
```

---

### Task 3: Settings UI

**Files:**
- Modify: `src/settings.html`
- Modify: `src/settings.js`

- [ ] **Step 1: Add input to settings.html**

In the "Position & Size" section, add after the `always_on_top` label:

```html
<label>Return to corner after (seconds, 0 = never) <input type="number" min="0" max="3600" id="return_to_corner_seconds" /></label>
```

So the section reads:
```html
<section>
  <h2>Position & Size</h2>
  <label>Corner
    <select id="corner">
      <option value="tl">Top Left</option>
      <option value="tr">Top Right</option>
      <option value="bl">Bottom Left</option>
      <option value="br">Bottom Right</option>
    </select>
  </label>
  <label>Size
    <select id="size">
      <option value="s">Small</option>
      <option value="m">Medium</option>
      <option value="l">Large</option>
    </select>
  </label>
  <label class="toggle">Always on top <input type="checkbox" id="always_on_top" /></label>
  <label>Return to corner after (seconds, 0 = never) <input type="number" min="0" max="3600" id="return_to_corner_seconds" /></label>
</section>
```

- [ ] **Step 2: Register field in settings.js**

In `src/settings.js`, add to the `fields` array:

```js
["return_to_corner_seconds", "number"],
```

Full updated `fields` array:
```js
const fields = [
  ["work_minutes", "number"],
  ["short_break_minutes", "number"],
  ["long_break_minutes", "number"],
  ["sessions_before_long_break", "number"],
  ["corner", "select"],
  ["size", "select"],
  ["always_on_top", "checkbox"],
  ["hide_until_one_minute", "checkbox"],
  ["auto_collapse", "checkbox"],
  ["sound_enabled", "checkbox"],
  ["volume", "number"],
  ["auto_advance", "checkbox"],
  ["autostart", "checkbox"],
  ["return_to_corner_seconds", "number"],
];
```

- [ ] **Step 3: Commit**

```
git add src/settings.html src/settings.js
git commit -m "feat: add return_to_corner_seconds to settings UI"
```

---

### Task 4: Return-to-corner logic in app.js

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add move listener and animation logic**

At the top of `app.js`, the existing imports already include `window.__TAURI__.core` and `window.__TAURI__.event`. Add the window import alongside them (line 3):

```js
const { getCurrentWindow } = window.__TAURI__.window;
```

- [ ] **Step 2: Add the return-to-corner module**

After the `init` function definition (before `init();` at the bottom), add:

```js
let returnCornerTimer = null;
let returnCornerSetup = false;

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

async function animateToCorner() {
  const [tx, ty] = await invoke("get_corner_position");
  const win = getCurrentWindow();
  const pos = await win.outerPosition();
  const startX = pos.x;
  const startY = pos.y;
  const duration = 400;
  const fps = 60;
  const steps = Math.round((duration / 1000) * fps);
  let step = 0;
  const interval = setInterval(async () => {
    step++;
    const t = step / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const x = lerp(startX, tx, ease);
    const y = lerp(startY, ty, ease);
    await invoke("set_window_position", { x, y });
    if (step >= steps) {
      clearInterval(interval);
      await invoke("set_window_position", { x: tx, y: ty });
    }
  }, 1000 / fps);
}

function scheduleReturnToCorner(delaySec) {
  if (returnCornerTimer) clearTimeout(returnCornerTimer);
  returnCornerTimer = setTimeout(() => {
    returnCornerTimer = null;
    animateToCorner();
  }, delaySec * 1000);
}

async function setupReturnToCorner() {
  if (returnCornerSetup) return;
  returnCornerSetup = true;
  const win = getCurrentWindow();
  await win.onMoved(() => {
    if (!settings || settings.return_to_corner_seconds === 0) return;
    scheduleReturnToCorner(settings.return_to_corner_seconds);
  });
}
```

- [ ] **Step 3: Call setupReturnToCorner in init**

In the `init` function, after `setupControls()`, add:

```js
await setupReturnToCorner();
```

Also update the `settings-updated` listener to cancel any pending timer when settings change:

```js
await listen("settings-updated", async () => {
  const wasRunning = running;
  settings = await invoke("get_settings");
  if (!wasRunning) remainingSec = phaseDuration(phase);
  if (settings.return_to_corner_seconds === 0 && returnCornerTimer) {
    clearTimeout(returnCornerTimer);
    returnCornerTimer = null;
  }
  render();
});
```

- [ ] **Step 4: Verify the full init function looks like this**

```js
async function init() {
  settings = await invoke("get_settings");
  remainingSec = phaseDuration(phase);
  applyPhaseClass();
  render();
  setupControls();
  await setupReturnToCorner();
  await listen("settings-updated", async () => {
    const wasRunning = running;
    settings = await invoke("get_settings");
    if (!wasRunning) remainingSec = phaseDuration(phase);
    if (settings.return_to_corner_seconds === 0 && returnCornerTimer) {
      clearTimeout(returnCornerTimer);
      returnCornerTimer = null;
    }
    render();
  });
}
```

- [ ] **Step 5: Commit**

```
git add src/app.js
git commit -m "feat: animate overlay back to corner after configurable delay"
```

---

### Task 5: Build and smoke test

- [ ] **Step 1: Build the app**

Run: `npm run tauri dev`
Expected: app launches with no console errors

- [ ] **Step 2: Test default behavior (0 seconds)**

Open settings, verify "Return to corner after" shows `0`. Drag the overlay to a random spot. It should stay there indefinitely.

- [ ] **Step 3: Test return behavior**

Set "Return to corner after" to `3`. Save. Drag the overlay to the center of the screen. After 3 seconds the overlay should smoothly animate back to its corner.

- [ ] **Step 4: Test reset on drag**

With the setting at `3`, drag the window. Before 3 seconds elapse, drag it again. The timer should reset and the window should only return 3 seconds after the second drag.

- [ ] **Step 5: Test disabling**

Set value back to `0`. Save. Drag the window. Confirm it no longer returns.
