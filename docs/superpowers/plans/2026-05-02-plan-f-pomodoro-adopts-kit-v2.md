# Plan F: Pomodoro Adopts Kit v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `pomodoro-overlay` to consume kit v2's drill-in settings UI, with built-in About / Theme / Reset pages and the new design system. Ship as `tauri-v0.3.0`. Verify end-to-end auto-update from `v0.2.1` to `v0.3.0` works.

**Architecture:** Pomodoro pulls latest kit submodule, adds `KitSettings` flatten to its `Settings` struct, registers `with_kit_commands` plugin, restructures its `renderSettingsPage` call to v2 API (passes `systemInline`, `about`, dangerActions), replaces v1 `checkAndPromptUpdate` with `runAutoUpdateCheck`, listens for `settings-reset` event in main window, then ships 0.3.0.

**Tech Stack:** Same as pomodoro current — Tauri 2, Rust, Vite, lit-html, TypeScript.

**Pre-req:** Plan E complete and pushed to kit `main`.

**Source spec:** `docs/superpowers/specs/2026-05-02-kit-v2-builtin-sections.md`

**All work happens in `C:\Users\tecno\Desktop\Projects\pomodoro-overlay`.**

---

## Task 1: Update kit submodule + add `with_kit_commands` plugin

**Files:**
- Modify: `vendor/tauri_kit/` (submodule pointer)
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Pull latest kit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/vendor/tauri_kit" pull origin main
```

Expected: fast-forward to whatever the current Plan E HEAD is.

- [ ] **Step 2: Read current `src-tauri/src/main.rs` to find the `tauri::Builder::default()` chain**

The chain currently includes:
```rust
.plugin(tauri_plugin_single_instance::init(...))
.plugin(tauri_plugin_notification::init())
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_autostart::init(...))
.plugin(tauri_kit_updater::plugin())
```

- [ ] **Step 3: Add `with_kit_commands` plugin**

Add after the existing `.plugin(tauri_kit_updater::plugin())` line:

```rust
.plugin(tauri_kit_settings::with_kit_commands())
```

- [ ] **Step 4: Verify cargo check**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/src-tauri"
cargo check
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add vendor/tauri_kit src-tauri/src/main.rs
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "CHORE: pull kit v2 submodule + register with_kit_commands plugin"
```

---

## Task 2: Add `KitSettings` flatten to `Settings` struct

**Files:**
- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Read current `src-tauri/src/settings.rs`**

Identify the `Settings` struct and its `Default` impl.

- [ ] **Step 2: Modify the `Settings` struct to include the kit flatten**

Replace the struct + Default impl in `src-tauri/src/settings.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri_kit_settings::KitSettings;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default)]
pub struct Settings {
    pub work_minutes: u32,
    pub short_break_minutes: u32,
    pub long_break_minutes: u32,
    pub sessions_before_long_break: u32,
    pub corner: String,
    pub width: u32,
    pub height: u32,
    pub idle_opacity: f32,
    pub auto_collapse: bool,
    pub sound_enabled: bool,
    pub sound_path: Option<String>,
    pub volume: f32,
    pub autostart: bool,
    pub always_on_top: bool,
    pub auto_advance: bool,
    pub return_to_corner_seconds: u32,
    pub fade_when: String,
    #[serde(flatten)]
    pub kit: KitSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            sessions_before_long_break: 4,
            corner: "br".to_string(),
            width: 300,
            height: 180,
            idle_opacity: 0.5,
            auto_collapse: true,
            sound_enabled: true,
            sound_path: None,
            volume: 0.7,
            autostart: false,
            always_on_top: true,
            auto_advance: true,
            return_to_corner_seconds: 0,
            fade_when: "always".to_string(),
            kit: KitSettings::default(),
        }
    }
}

impl Settings {
    pub fn expanded_size(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}

pub struct SettingsState(pub Mutex<Settings>);

const SETTINGS_FILENAME: &str = "settings.json";

pub fn load(app: &AppHandle) -> Settings {
    tauri_kit_settings::load_for::<_, Settings>(app, SETTINGS_FILENAME).unwrap_or_default()
}

pub fn persist(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    tauri_kit_settings::save_for(app, SETTINGS_FILENAME, settings).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Verify cargo build**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/src-tauri"
cargo check
```

Expected: passes.

- [ ] **Step 4: Verify settings file shape preserved (manual)**

Read your current `%APPDATA%\com.sirbepy.pomodoro-overlay\settings.json`. After this code change, the file shape is **unchanged** for existing users — the new `__kit_theme` and `__kit_auto_update` keys default to `"system"` / `"onStartup"` if missing in the loaded JSON, and aren't written until the user changes them via the settings UI. Existing JSON files round-trip without modification.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add src-tauri/src/settings.rs
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "REFACTOR: flatten KitSettings into pomodoro Settings struct"
```

---

## Task 3: Update `src/settings/schema.ts` — move autostart to systemInline

**Files:**
- Modify: `src/settings/schema.ts`

The plan: pomodoro's existing `Behavior` section currently has `auto_advance` + `autostart`. Kit v2 wants `autostart` rendered as a System inline row alongside Theme/About. So we move it.

- [ ] **Step 1: Update `src/settings/schema.ts`**

Read existing file. Modify the Behavior section's fields array to remove `autostart`. Result:

```ts
import { defineSchema } from "../../vendor/tauri_kit/frontend/settings/schema";

export const settingsSchema = defineSchema({
  sections: [
    {
      title: "Times (minutes)",
      fields: [
        { key: "work_minutes", kind: "integer", label: "Pomodoro", min: 1, max: 180 },
        { key: "short_break_minutes", kind: "integer", label: "Short break", min: 1, max: 60 },
        { key: "long_break_minutes", kind: "integer", label: "Long break", min: 1, max: 120 },
        { key: "sessions_before_long_break", kind: "integer", label: "Sessions before long break", min: 1, max: 10 },
      ],
    },
    {
      title: "Position & Size",
      fields: [
        {
          key: "corner",
          kind: "select",
          label: "Corner",
          options: [
            { value: "tl", label: "Top Left" },
            { value: "tr", label: "Top Right" },
            { value: "bl", label: "Bottom Left" },
            { value: "br", label: "Bottom Right" },
          ],
        },
        { key: "always_on_top", kind: "toggle", label: "Always on top" },
        { key: "return_to_corner_seconds", kind: "integer", label: "Return to corner after (s, 0=never)", min: 0, max: 3600 },
      ],
    },
    {
      title: "Visibility",
      fields: [
        {
          key: "fade_when",
          kind: "select",
          label: "Fade when not hovered",
          options: [
            { value: "never", label: "Never" },
            { value: "running", label: "Only when timer is running" },
            { value: "always", label: "Always" },
          ],
        },
        { key: "idle_opacity", kind: "range", label: "Transparent off hover", min: 0, max: 1, step: 0.05 },
        { key: "auto_collapse", kind: "toggle", label: "Collapse on mouse leave" },
      ],
    },
    {
      title: "Sound",
      fields: [
        { key: "sound_enabled", kind: "toggle", label: "Play sound on timer end" },
        { key: "volume", kind: "range", label: "Volume", min: 0, max: 1, step: 0.05 },
        {
          key: "sound_path",
          kind: "file",
          label: "Custom sound",
          pickerCommand: "pick_sound_file",
          defaultLabel: "Default tone",
        },
      ],
    },
    {
      title: "Behavior",
      fields: [
        { key: "auto_advance", kind: "toggle", label: "Auto-start next phase" },
      ],
    },
  ],
});

/** App-specific rows that render inline under the kit's System category. */
export const systemInline = [
  { key: "autostart", kind: "toggle" as const, label: "Launch at startup" },
];
```

- [ ] **Step 2: tsc check**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 3: No commit yet** — combine with Task 4.

---

## Task 4: Update `src/settings/main.ts` to use kit v2 API

**Files:**
- Modify: `src/settings/main.ts`

- [ ] **Step 1: Replace `src/settings/main.ts`**

```ts
import "../../vendor/tauri_kit/frontend/settings/styles.css";
import { renderSettingsPage } from "../../vendor/tauri_kit/frontend/settings/renderer";
import { settingsSchema, systemInline } from "./schema";

const root = document.getElementById("root");
if (!root) throw new Error("settings root missing");

renderSettingsPage(root, {
  schema: settingsSchema,
  systemInline,
  // No app-specific danger actions for pomodoro yet (Reset is shipped by kit).
  dangerActions: [],
  // Use kit defaults for developer info; appName + appVersion auto-pulled from tauri.conf.json.
  about: {},
});
```

- [ ] **Step 2: Verify Vite build**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npm run build
```

Expected: succeeds. New bundle for settings.html should be larger (now includes kit v2 page modules + design system CSS).

- [ ] **Step 3: Commit Tasks 3+4**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add src/settings
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "REFACTOR: pomodoro adopts kit v2 settings API; autostart moves to systemInline"
```

---

## Task 5: Replace `checkAndPromptUpdate` with `runAutoUpdateCheck`

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Read current top of `src/app.js`**

The first line should currently be:
```js
import { checkAndPromptUpdate } from "../vendor/tauri_kit/frontend/updater/check";
```

And somewhere near the top:
```js
checkAndPromptUpdate();
```

- [ ] **Step 2: Replace import + call**

Change line 1 from `checkAndPromptUpdate` to `runAutoUpdateCheck`:

```js
import { runAutoUpdateCheck } from "../vendor/tauri_kit/frontend/updater/auto-check";
```

Change the fire-and-forget call site:

```js
// Fire-and-forget. Reads __kit_auto_update from settings to decide behavior.
runAutoUpdateCheck();
```

- [ ] **Step 3: Verify Vite build**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add src/app.js
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "REFACTOR: app startup uses runAutoUpdateCheck (mode-aware) instead of always-prompt"
```

---

## Task 6: Wire `settings-reset` event handler in main window

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Read existing `src/app.js`**

Find where `listen("settings-updated", ...)` is registered (it should already exist — look near where settings are loaded into app state).

- [ ] **Step 2: Add a handler for `settings-reset`**

Right after the existing `settings-updated` listener, add:

```js
listen("settings-reset", async () => {
  // Settings file was deleted by kit_reset_settings command.
  // Re-load settings (will return Settings::default() since file is gone).
  settings = await invoke("get_settings");
  applySettings(settings); // existing helper that re-applies size/position/etc.
});
```

If the function name is different (e.g. `applyLoadedSettings`), use that. Read the existing handler for `settings-updated` to see the convention.

- [ ] **Step 3: Verify Vite build**

```bash
npm run build
```

Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add src/app.js
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "FEAT: main window listens for settings-reset event and reloads"
```

---

## Task 7: Update CSP if needed + add clipboard capability

**Files:**
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src/settings.html` (CSP only if needed)

The kit's `kit_copy_logs` flow uses `navigator.clipboard.writeText`. Browsers gate this behind a permission, which Tauri already handles via the standard webview. No Tauri capability is needed for `navigator.clipboard` itself.

For the settings window's CSP: kit's About page loads Phosphor icons via the `unpkg.com` script tag already in `settings.html`. CSP shouldn't need changes.

- [ ] **Step 1: Verify capabilities/default.json has the existing entries we need**

Read `src-tauri/capabilities/default.json`. Confirm it includes:
- `core:event:default` (for `listen` and `emit`)
- `dialog:allow-ask` (for kit's update prompt — added in Plan C)
- `updater:default` (added in Plan C)

These should already be present from earlier plans.

- [ ] **Step 2: Verify `settings.html` script tag for Phosphor icons**

Read `src/settings.html`. Should already have:
```html
<script src="https://unpkg.com/@phosphor-icons/web"></script>
```

…in the `<head>` from Plan A. The CSP in `settings.html` allows `script-src 'self' 'unsafe-inline' https://unpkg.com` — fine.

- [ ] **Step 3: No code changes if everything checks out**

If both checks pass, this task is a verify-only no-op. Skip the commit; move to Task 8.

If something's missing, fix it minimally and commit:

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add src-tauri/capabilities/default.json src/settings.html
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "CHORE: capabilities/CSP adjustments for kit v2"
```

---

## Task 8: Manual visual + functional check (skip pre-merge)

**Files:** none modified.

This is a verification step. Run dev mode and click through every page.

- [ ] **Step 1: Run tauri dev**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npm run tauri dev
```

Expected: pomodoro overlay launches normally (timer, hover, etc. unaffected).

- [ ] **Step 2: Open settings via tray**

Right-click tray → Settings (or however pomodoro opens settings).

Expected: drill-in settings UI appears. Centered "Settings" title. App-defined sections list (Times, Position & Size, Visibility, Sound, Behavior). System category with Theme + Launch at startup (toggle, inline) + About. Danger zone with Reset.

- [ ] **Step 3: Drill into each section**

Click each app-defined section (Times, Position, etc). Verify:
- Centered section title
- All current fields present and populated with current values
- Back arrow returns to root
- Changing a value persists immediately (auto-save behavior — no Save button in v2)

- [ ] **Step 4: Theme picker**

Click Theme. Try Light / Dark / System cards. Each should:
- Apply visually immediately (CSS vars switch)
- Persist (back to root, re-enter Theme, current selection still highlighted)
- Confirm system mode follows OS dark/light preference

- [ ] **Step 5: About page**

Click About. Verify:
- Centered "About" title
- Hero: "Pomodoro Overlay" + "v0.2.1 (or whatever you've installed)"
- "Up to date" status
- Auto-update select shows current value (default "On startup")
- "↻ Check for updates now" button works (no-op if up to date, otherwise prompts)
- Tap version 5x within 3 seconds → "Copy debug logs" button appears
- Click Copy logs → text "no logs available" copied to clipboard
- Developer block at bottom: "Made by SirBepy" + GitHub + YouTube icon links

- [ ] **Step 6: Reset flow**

Back to root. Click "Reset all settings". Modal appears. Click Cancel → modal dismisses, no change.

Click "Reset all settings" again. Click Reset → settings file deleted, settings window closes, main window picks up `settings-reset` event and overlay re-applies defaults (work_minutes=25 etc., size resets, corner=br).

- [ ] **Step 7: Note any visual issues**

If visual quality is unacceptable (truly ugly, broken layout, dark theme illegible), report back. Do not bump to 0.3.0 with broken UX.

- [ ] **Step 8: No commit (verification step)**

---

## Task 9: Bump to 0.3.0

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Bump all 3 version sources from current (0.2.1) to 0.3.0**

`package.json`:
```json
  "version": "0.3.0",
```

`src-tauri/tauri.conf.json`:
```json
  "version": "0.3.0",
```

`src-tauri/Cargo.toml`:
```toml
version = "0.3.0"
```

- [ ] **Step 2: Cargo check**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/src-tauri"
cargo check
```

Expected: passes (Cargo.lock auto-updates).

- [ ] **Step 3: Final smoke build**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npm run build
```

Expected: dist/ produced, no errors.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "CHORE: bump to v0.3.0 (kit v2 adoption)"
```

---

## Task 10: Push + watch CI + verify auto-update

**Files:** none modified.

- [ ] **Step 1: Push**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" push origin main
```

CI fires immediately on push to main.

- [ ] **Step 2: Watch CI**

```bash
gh run watch -R SirBepy/pomodoro-overlay
```

Expected stages all green: check → tag → build → publish. Build takes ~10-15 min.

- [ ] **Step 3: Verify release published**

```bash
gh release view tauri-v0.3.0 -R SirBepy/pomodoro-overlay
```

Expected attached files: `Pomodoro-Overlay_0.3.0_windows_x64.exe`, `.exe.sig`, `.msi`, `latest.json`.

- [ ] **Step 4: Verify `latest.json` shape**

```bash
curl -sL https://github.com/SirBepy/pomodoro-overlay/releases/latest/download/latest.json
```

Expected:
```json
{
  "version": "0.3.0",
  "notes": "Release 0.3.0",
  "pub_date": "...",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/SirBepy/pomodoro-overlay/releases/download/tauri-v0.3.0/Pomodoro-Overlay_0.3.0_windows_x64.exe"
    }
  }
}
```

- [ ] **Step 5: End-to-end auto-update test**

User has v0.2.1 installed (from Plan C E2E test). Launch the installed v0.2.1.

Within ~5 seconds, expect a dialog: **"Version 0.3.0 is available. Install now?"**

(This is the `runAutoUpdateCheck` in `onStartup` mode behavior — same as v0.2.1 prompted before, since auto-update mode persists from previous version.)

Click Yes → downloads + installs + restarts at 0.3.0.

- [ ] **Step 6: Verify settings preserved**

After upgrade, open settings. Check that:
- All previous values intact (work_minutes, corner, etc.)
- New `__kit_theme` defaults to "system" (since not previously set)
- New `__kit_auto_update` defaults to "onStartup"
- Underlying JSON file at `%APPDATA%\com.sirbepy.pomodoro-overlay\settings.json` includes all old + new keys

- [ ] **Step 7: Test the new About page in production**

Click About. Verify all the same checks from Task 8 Step 5 work in the production build.

- [ ] **Step 8: Test theme persistence**

Change theme to Dark. Close settings. Re-open settings. Verify theme persisted across window close.

- [ ] **Step 9: No final commit (verification only)**

If anything failed at any step, file an `.for_bepy/ai_todos/<n>-fix-<issue>.md` describing the problem and stop. Don't ship a regressing release.

---

## Self-review checklist

Before declaring Plan F done:

- [ ] Pomodoro `cargo check` passes
- [ ] Pomodoro `npm run build` produces dist
- [ ] Manual UX test (Task 8) clean — every page reachable, no visual breakage
- [ ] CI run for `tauri-v0.3.0` succeeded
- [ ] GitHub release exists with correct artifacts + signed `latest.json`
- [ ] v0.2.1 → v0.3.0 update prompt + install verified end-to-end
- [ ] Settings file shape preserved across upgrade (old keys + new `__kit_*` keys)
- [ ] About page works (version, easter-egg unlock, copy logs, dev links)
- [ ] Theme picker persists and applies CSS vars
- [ ] Reset modal works (cancel + confirm both)
- [ ] No regressions: pomodoro overlay timer/hover/corner behavior unchanged

---

## Out of scope

- claude_usage_in_taskbar adoption (Phase 2, separate spec — same deferral as before)
- Settings schema migrations beyond defaults (no hand-rolled migration code; kit relies on serde defaults for new fields)
- Themes beyond light/dark/system
- Mac/Linux pomodoro builds
- Logging infrastructure for `kit_copy_logs` (placeholder behavior is acceptable)
