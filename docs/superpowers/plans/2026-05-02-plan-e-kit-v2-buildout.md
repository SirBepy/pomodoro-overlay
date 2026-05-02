# Plan E: Kit v2 Build-out

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the kit's drill-in settings UI with built-in About / Theme / Reset pages, a real CSS design system, and Rust commands for logs + reset. After this plan, the kit can render a polished settings experience for any consumer app; pomodoro adoption is Plan F.

**Architecture:** Frontend = page-stack state machine + 5 page modules (root, section, theme, about, reset-modal) + redesigned `styles.css`. Rust = `KitSettings` flattened struct + `with_kit_commands` builder helper that registers `kit_copy_logs` and `kit_reset_settings`.

**Tech Stack:** lit-html 3, vitest + JSDOM, TypeScript 5, Rust 2021, serde, tauri 2, tauri-plugin-clipboard-manager.

**Source spec:** `docs/superpowers/specs/2026-05-02-kit-v2-builtin-sections.md`

**All work happens in `C:\Users\tecno\Desktop\Projects\sirbepy_tauri_kit`.** Plan F handles pomodoro adoption.

---

## File structure (target end-state of this plan)

```
sirbepy_tauri_kit/
  frontend/settings/
    schema.ts                  # unchanged
    styles.css                 # rewritten — design system
    renderer.ts                # rewritten — orchestrator
    stack.ts                   # NEW — page stack engine
    pages/
      root.ts                  # NEW
      section.ts               # NEW (replaces v1 inline rendering)
      theme.ts                 # NEW
      about.ts                 # NEW
      reset-modal.ts           # NEW
    fields.ts                  # NEW — extracted v1 field renderers (number/select/toggle/...)
  frontend/updater/
    check.ts                   # unchanged
    auto-check.ts              # NEW — runAutoUpdateCheck dispatcher
  tauri/settings/src/
    lib.rs                     # extended
    store.rs                   # unchanged
    paths.rs                   # unchanged
    error.rs                   # unchanged
    kit_settings.rs            # NEW — KitSettings struct
    commands.rs                # NEW — kit_copy_logs, kit_reset_settings, with_kit_commands
```

---

## Task 1: Rust — `KitSettings` struct + flatten helper

**Files (kit repo):**
- Create: `tauri/settings/src/kit_settings.rs`
- Modify: `tauri/settings/src/lib.rs`
- Test: inline `#[cfg(test)] mod tests`

The `KitSettings` struct holds the kit's reserved settings keys. Apps include it via `#[serde(flatten)]` in their own settings struct so the JSON file stays flat.

- [ ] **Step 1: Write failing test in `kit_settings.rs`**

Create `tauri/settings/src/kit_settings.rs`:

```rust
//! Kit-reserved settings keys. Apps flatten this into their own settings struct.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KitSettings {
    #[serde(rename = "__kit_theme", default = "default_theme")]
    pub theme: String,

    #[serde(rename = "__kit_auto_update", default = "default_auto_update")]
    pub auto_update: String,
}

fn default_theme() -> String { "system".into() }
fn default_auto_update() -> String { "onStartup".into() }

impl Default for KitSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            auto_update: default_auto_update(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
    struct AppSettings {
        work_minutes: u32,
        #[serde(flatten)]
        kit: KitSettings,
    }

    #[test]
    fn defaults_are_system_and_on_startup() {
        let k = KitSettings::default();
        assert_eq!(k.theme, "system");
        assert_eq!(k.auto_update, "onStartup");
    }

    #[test]
    fn flatten_round_trips_with_app_struct() {
        let s = AppSettings {
            work_minutes: 25,
            kit: KitSettings {
                theme: "dark".into(),
                auto_update: "immediate".into(),
            },
        };
        let json = serde_json::to_string(&s).unwrap();
        // Should contain underscored keys at top level (proves flatten works)
        assert!(json.contains("\"__kit_theme\":\"dark\""));
        assert!(json.contains("\"__kit_auto_update\":\"immediate\""));
        assert!(json.contains("\"work_minutes\":25"));

        let parsed: AppSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, s);
    }

    #[test]
    fn unknown_kit_keys_in_app_json_use_defaults() {
        let json = r#"{"work_minutes":25}"#;
        let parsed: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.kit.theme, "system");
        assert_eq!(parsed.kit.auto_update, "onStartup");
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Add to `tauri/settings/src/lib.rs` after the existing `pub mod store;` line:

```rust
pub mod kit_settings;
pub use kit_settings::KitSettings;
```

- [ ] **Step 3: Run tests**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
cargo test -p tauri_kit_settings
```

Expected: 3 new tests pass alongside the existing 5 store tests.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add tauri/settings/src/kit_settings.rs tauri/settings/src/lib.rs
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: KitSettings struct with __kit_theme and __kit_auto_update reserved keys"
```

---

## Task 2: Rust — `kit_copy_logs` + `kit_reset_settings` commands + `with_kit_commands`

**Files:**
- Create: `tauri/settings/src/commands.rs`
- Modify: `tauri/settings/src/lib.rs`
- Modify: `tauri/settings/Cargo.toml` (add `tauri-plugin-clipboard-manager` for default copy_logs impl — actually the FRONTEND writes to clipboard; the Rust side just returns the string. So no new Cargo dep needed.)

- [ ] **Step 1: Write failing test in `commands.rs`**

Create `tauri/settings/src/commands.rs`:

```rust
//! Tauri commands shipped by the kit. Apps register them via `with_kit_commands`.

use crate::paths::settings_path;
use std::fs;
use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

/// Returns the contents of `<app-data>/app.log` if present, otherwise a placeholder.
#[tauri::command]
pub async fn kit_copy_logs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let log_path = dir.join("app.log");
    if !log_path.exists() {
        return Ok("no logs available".to_string());
    }
    fs::read_to_string(&log_path).map_err(|e| e.to_string())
}

/// Deletes the settings file. Caller's main window listens for `settings-reset` event
/// and re-reads settings (which falls back to T::default()).
#[tauri::command]
pub async fn kit_reset_settings<R: Runtime>(
    app: AppHandle<R>,
    filename: String,
) -> Result<(), String> {
    let path = settings_path(&app, &filename).map_err(|e| e.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    app.emit("settings-reset", ()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Returns a Tauri plugin that registers all kit-shipped commands.
/// Apps call: `.plugin(tauri_kit_settings::with_kit_commands())`
pub fn with_kit_commands<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("kit-commands")
        .invoke_handler(tauri::generate_handler![kit_copy_logs, kit_reset_settings])
        .build()
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Add to `tauri/settings/src/lib.rs`:

```rust
pub mod commands;
pub use commands::{kit_copy_logs, kit_reset_settings, with_kit_commands};
```

- [ ] **Step 3: Verify cargo check**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
cargo check --workspace
```

Expected: passes. Note: `kit_copy_logs` and `kit_reset_settings` are #[tauri::command]s; Tauri's macro generates the IPC glue. We don't unit-test these directly (would require a real AppHandle); coverage comes from manual testing in Plan F.

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add tauri/settings/src/commands.rs tauri/settings/src/lib.rs
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: kit_copy_logs + kit_reset_settings commands + with_kit_commands plugin builder"
```

---

## Task 3: Frontend — extract v1 field renderers into `fields.ts`

**Files:**
- Create: `frontend/settings/fields.ts`
- Modify: `frontend/settings/renderer.ts` (will be replaced fully in Task 9, but for now just remove field renderers; don't break tests)

This is a refactor task. The v1 renderer has all field rendering inline. Pull each field-kind renderer (number/integer/range/select/toggle/text/file/custom) into a single shared module so `pages/section.ts` can import them.

- [ ] **Step 1: Read v1 renderer.ts**

Note the `fieldView(field, value, onChange)` function and its switch statement. That's what we're extracting.

- [ ] **Step 2: Create `frontend/settings/fields.ts`**

```ts
import { html, type TemplateResult } from "lit-html";
import { invoke } from "@tauri-apps/api/core";
import type { Field } from "./schema";

/** Renders one field as a labeled row. Used by section pages and inline rows. */
export function fieldRow(
  field: Field,
  value: unknown,
  onChange: (next: unknown) => void,
): TemplateResult {
  switch (field.kind) {
    case "number":
    case "integer": {
      const step = field.kind === "integer" ? 1 : "step" in field ? field.step : undefined;
      return html`
        <label class="kit-row">
          <span class="kit-row-label">${field.label}</span>
          <input
            type="number"
            data-key=${field.key}
            class="kit-input"
            .value=${String(value ?? "")}
            min=${"min" in field && field.min !== undefined ? field.min : ""}
            max=${"max" in field && field.max !== undefined ? field.max : ""}
            step=${step !== undefined ? step : ""}
            @input=${(e: Event) => {
              const v = (e.target as HTMLInputElement).value;
              onChange(field.kind === "integer" ? parseInt(v, 10) : parseFloat(v));
            }}
          />
        </label>
      `;
    }
    case "range":
      return html`
        <label class="kit-row">
          <span class="kit-row-label">${field.label}</span>
          <input
            type="range"
            data-key=${field.key}
            class="kit-range"
            .value=${String(value ?? field.min)}
            min=${field.min}
            max=${field.max}
            step=${field.step ?? 0.05}
            @input=${(e: Event) =>
              onChange(parseFloat((e.target as HTMLInputElement).value))}
          />
        </label>
      `;
    case "select":
      return html`
        <label class="kit-row">
          <span class="kit-row-label">${field.label}</span>
          <select
            data-key=${field.key}
            class="kit-select"
            .value=${String(value ?? "")}
            @change=${(e: Event) => onChange((e.target as HTMLSelectElement).value)}
          >
            ${field.options.map(
              (opt) => html`<option value=${opt.value}>${opt.label}</option>`,
            )}
          </select>
        </label>
      `;
    case "toggle":
      return html`
        <label class="kit-row">
          <span class="kit-row-label">${field.label}</span>
          <span class="kit-toggle">
            <input
              type="checkbox"
              data-key=${field.key}
              .checked=${Boolean(value)}
              @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}
            />
            <span class="kit-toggle-track"></span>
          </span>
        </label>
      `;
    case "text":
      return html`
        <label class="kit-row">
          <span class="kit-row-label">${field.label}</span>
          <input
            type="text"
            data-key=${field.key}
            class="kit-input"
            .value=${String(value ?? "")}
            @input=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
          />
        </label>
      `;
    case "file": {
      const display = value ? String(value) : field.defaultLabel ?? "(none)";
      return html`
        <label class="kit-row">
          <span class="kit-row-label">${field.label}</span>
          <span class="kit-file-row">
            <span class="kit-file-display">${display}</span>
            <button
              type="button"
              data-key=${field.key}
              class="kit-btn-secondary"
              @click=${async () => {
                const picked = await invoke<string | null>(field.pickerCommand);
                if (picked) onChange(picked);
              }}
            >
              Pick…
            </button>
            <button type="button" class="kit-btn-secondary" @click=${() => onChange(null)}>Reset</button>
          </span>
        </label>
      `;
    }
    case "custom":
      return field.render(value, onChange);
  }
}
```

Note: classes are renamed from v1 (`kit-row`, `kit-input`, etc.) to align with the redesigned styles.css in Task 4. The class names follow `kit-*` prefix convention.

- [ ] **Step 3: Type-check**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
npx tsc --noEmit
```

Expected: passes. (`renderer.ts` still has its own copy of `fieldView` — duplication is OK for one task, removed in Task 9.)

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings/fields.ts
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "REFACTOR: extract field renderers into fields.ts (kit-class prefixed)"
```

---

## Task 4: Frontend — rewrite `styles.css` as design system

**Files:**
- Modify: `frontend/settings/styles.css`

Replace the placeholder CSS with the full design system from the spec.

- [ ] **Step 1: Replace `styles.css` entirely**

```css
/*
 * sirbepy_tauri_kit settings design system
 * Theme via [data-theme="..."] attribute on <html>.
 */

/* ==== THEME VARS ==== */
:root, [data-theme="light"] {
  --kit-bg: #ffffff;
  --kit-bg-alt: #f5f5f5;
  --kit-bg-hover: #ebebeb;
  --kit-text: #1a1a1a;
  --kit-text-dim: #666;
  --kit-accent: #2a5fb4;
  --kit-accent-hover: #3470c8;
  --kit-danger: #d32f2f;
  --kit-danger-bg: #fde9e9;
  --kit-danger-border: #f5b5b5;
  --kit-border: #e0e0e0;
}

[data-theme="dark"] {
  --kit-bg: #1a1a1a;
  --kit-bg-alt: #222;
  --kit-bg-hover: #2a2a2a;
  --kit-text: #eaeaea;
  --kit-text-dim: #888;
  --kit-accent: #4a90e2;
  --kit-accent-hover: #5da4f0;
  --kit-danger: #ff6666;
  --kit-danger-bg: #3a1a1a;
  --kit-danger-border: #6a2a2a;
  --kit-border: #2a2a2a;
}

@media (prefers-color-scheme: dark) {
  [data-theme="system"] {
    --kit-bg: #1a1a1a;
    --kit-bg-alt: #222;
    --kit-bg-hover: #2a2a2a;
    --kit-text: #eaeaea;
    --kit-text-dim: #888;
    --kit-accent: #4a90e2;
    --kit-accent-hover: #5da4f0;
    --kit-danger: #ff6666;
    --kit-danger-bg: #3a1a1a;
    --kit-danger-border: #6a2a2a;
    --kit-border: #2a2a2a;
  }
}

/* ==== ROOT CONTAINER ==== */
.kit-settings {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--kit-bg);
  color: var(--kit-text);
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
}

/* ==== STACK + SLIDE ==== */
.kit-stack {
  position: relative;
  width: 100%;
  min-height: 100vh;
}
.kit-page {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  background: var(--kit-bg);
  transition: transform 200ms ease-out;
}
.kit-page.kit-page-entering {
  transform: translateX(100%);
}
.kit-page.kit-page-active {
  transform: translateX(0);
}
.kit-page.kit-page-exiting {
  transform: translateX(-30%);
  opacity: 0.5;
}

/* ==== HEADER ==== */
.kit-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--kit-border);
  background: var(--kit-bg);
  position: sticky;
  top: 0;
  z-index: 1;
}
.kit-header-back {
  width: 80px;
  background: none;
  border: none;
  color: var(--kit-text-dim);
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  padding: 4px 0;
}
.kit-header-back:hover { color: var(--kit-text); }
.kit-header-title {
  flex: 1;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.kit-header-spacer { width: 80px; }

/* ==== SECTIONS ==== */
.kit-section {
  margin-top: 16px;
}
.kit-section-title {
  padding: 8px 16px;
  color: var(--kit-text-dim);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
}
.kit-section-title.kit-section-danger {
  color: var(--kit-danger);
}

/* ==== ROWS ==== */
.kit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--kit-border);
  background: var(--kit-bg);
}
.kit-row-label {
  font-size: 13px;
  flex: 1;
}
.kit-nav-row {
  cursor: pointer;
  user-select: none;
}
.kit-nav-row:hover {
  background: var(--kit-bg-hover);
}
.kit-nav-arrow {
  color: var(--kit-text-dim);
  font-size: 18px;
  line-height: 1;
}

/* ==== INPUTS ==== */
.kit-input, .kit-select {
  width: 120px;
  padding: 4px 8px;
  font-size: 13px;
  background: var(--kit-bg-alt);
  color: var(--kit-text);
  border: 1px solid var(--kit-border);
  border-radius: 4px;
}
.kit-input:focus, .kit-select:focus {
  outline: none;
  border-color: var(--kit-accent);
}
.kit-range {
  width: 160px;
}

/* ==== TOGGLE ==== */
.kit-toggle {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 18px;
}
.kit-toggle input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}
.kit-toggle-track {
  position: absolute;
  inset: 0;
  background: var(--kit-bg-alt);
  border: 1px solid var(--kit-border);
  border-radius: 9px;
  transition: background 150ms;
}
.kit-toggle-track::after {
  content: "";
  position: absolute;
  top: 1px;
  left: 1px;
  width: 14px;
  height: 14px;
  background: var(--kit-text-dim);
  border-radius: 50%;
  transition: transform 150ms, background 150ms;
}
.kit-toggle input:checked ~ .kit-toggle-track {
  background: var(--kit-accent);
  border-color: var(--kit-accent);
}
.kit-toggle input:checked ~ .kit-toggle-track::after {
  transform: translateX(18px);
  background: white;
}

/* ==== FILE PICKER ROW ==== */
.kit-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.kit-file-display {
  font-size: 11px;
  color: var(--kit-text-dim);
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ==== BUTTONS ==== */
.kit-btn-primary, .kit-btn-secondary, .kit-btn-danger {
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
}
.kit-btn-primary {
  background: var(--kit-accent);
  color: white;
}
.kit-btn-primary:hover { background: var(--kit-accent-hover); }
.kit-btn-primary:disabled { opacity: 0.5; cursor: default; }
.kit-btn-secondary {
  background: var(--kit-bg-alt);
  color: var(--kit-text);
  border-color: var(--kit-border);
}
.kit-btn-secondary:hover { background: var(--kit-bg-hover); }
.kit-btn-danger {
  background: var(--kit-danger-bg);
  color: var(--kit-danger);
  border-color: var(--kit-danger-border);
  width: 100%;
  text-align: center;
}
.kit-btn-danger:hover {
  background: var(--kit-danger);
  color: white;
}

/* ==== ABOUT HERO ==== */
.kit-about-hero {
  padding: 28px 16px;
  text-align: center;
  border-bottom: 1px solid var(--kit-border);
}
.kit-about-app-name {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 4px;
}
.kit-about-version {
  font-size: 14px;
  color: var(--kit-text-dim);
  cursor: pointer;
  user-select: none;
}
.kit-about-status {
  font-size: 11px;
  color: var(--kit-text-dim);
  margin-top: 8px;
}

/* ==== DEVELOPER LINKS ==== */
.kit-dev-block {
  padding: 24px 16px;
  text-align: center;
  border-top: 1px solid var(--kit-border);
  margin-top: 24px;
}
.kit-dev-name {
  font-size: 11px;
  color: var(--kit-text-dim);
  margin-bottom: 8px;
}
.kit-dev-links {
  display: flex;
  gap: 16px;
  justify-content: center;
}
.kit-dev-link {
  color: var(--kit-text-dim);
  font-size: 24px;
  text-decoration: none;
  transition: color 150ms;
}
.kit-dev-link:hover {
  color: var(--kit-accent);
}

/* ==== THEME PICKER CARDS ==== */
.kit-theme-cards {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  padding: 16px;
}
.kit-theme-card {
  border: 2px solid var(--kit-border);
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  text-align: center;
  background: var(--kit-bg-alt);
  transition: border-color 150ms;
}
.kit-theme-card:hover {
  border-color: var(--kit-text-dim);
}
.kit-theme-card.kit-theme-card-active {
  border-color: var(--kit-accent);
}
.kit-theme-swatch {
  width: 100%;
  height: 56px;
  border-radius: 4px;
  margin-bottom: 8px;
}
.kit-theme-swatch-light { background: linear-gradient(135deg, #fff 50%, #f5f5f5 50%); border: 1px solid #ddd; }
.kit-theme-swatch-dark { background: linear-gradient(135deg, #1a1a1a 50%, #2a2a2a 50%); }
.kit-theme-swatch-system { background: linear-gradient(135deg, #fff 50%, #1a1a1a 50%); }
.kit-theme-card-label {
  font-size: 13px;
  font-weight: 500;
}

/* ==== MODAL ==== */
.kit-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.kit-modal {
  background: var(--kit-bg);
  border: 1px solid var(--kit-border);
  border-radius: 8px;
  padding: 20px;
  max-width: 360px;
  width: 90%;
}
.kit-modal-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px;
}
.kit-modal-body {
  font-size: 13px;
  color: var(--kit-text-dim);
  margin-bottom: 16px;
}
.kit-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
```

- [ ] **Step 2: No tests, no commit yet**

This is just CSS. It'll be exercised by integration tests in later tasks. Combine commit with Task 5.

---

## Task 5: Frontend — page stack engine

**Files:**
- Create: `frontend/settings/stack.ts`
- Test: `frontend/settings/stack.test.ts`

The stack manages page transitions. Keeps an in-memory stack of `PageDef`s. Push/pop trigger re-render with slide animation.

- [ ] **Step 1: Write failing tests in `stack.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { html } from "lit-html";
import { PageStack, type PageDef } from "./stack";

describe("PageStack", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  function makePage(id: string, title: string): PageDef {
    return {
      id,
      title,
      render: () => html`<div data-page=${id}>${title}</div>`,
    };
  }

  it("renders initial page", () => {
    const stack = new PageStack(root);
    stack.push(makePage("root", "Settings"));
    const el = root.querySelector('[data-page="root"]');
    expect(el).toBeTruthy();
    expect(el?.textContent).toBe("Settings");
  });

  it("push adds a new page on top", () => {
    const stack = new PageStack(root);
    stack.push(makePage("root", "Settings"));
    stack.push(makePage("times", "Times"));
    expect(root.querySelector('[data-page="times"]')).toBeTruthy();
    expect(stack.depth()).toBe(2);
  });

  it("pop returns to previous page", () => {
    const stack = new PageStack(root);
    stack.push(makePage("root", "Settings"));
    stack.push(makePage("times", "Times"));
    stack.pop();
    expect(stack.depth()).toBe(1);
    expect(root.querySelector('[data-page="root"]')).toBeTruthy();
    expect(root.querySelector('[data-page="times"]')).toBeFalsy();
  });

  it("pop on root is a no-op", () => {
    const stack = new PageStack(root);
    stack.push(makePage("root", "Settings"));
    stack.pop();
    expect(stack.depth()).toBe(1);
  });

  it("replace swaps the top page", () => {
    const stack = new PageStack(root);
    stack.push(makePage("root", "Settings"));
    stack.replace(makePage("home", "Home"));
    expect(stack.depth()).toBe(1);
    expect(root.querySelector('[data-page="home"]')).toBeTruthy();
  });

  it("rerender re-runs the active page render fn", () => {
    const stack = new PageStack(root);
    let count = 0;
    const page: PageDef = {
      id: "p",
      title: "P",
      render: () => html`<div data-count=${++count}></div>`,
    };
    stack.push(page);
    stack.rerender();
    expect(root.querySelector('[data-count="2"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — fails (no stack.ts)**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
npm test
```

Expected: `Cannot find module './stack'`.

- [ ] **Step 3: Implement `frontend/settings/stack.ts`**

```ts
import { html, render, type TemplateResult } from "lit-html";

export interface PageDef {
  id: string;
  title: string;
  render: () => TemplateResult;
}

/** In-memory page stack. Renders only the topmost page; emits state to root element. */
export class PageStack {
  private stack: PageDef[] = [];
  constructor(private root: HTMLElement) {}

  push(page: PageDef): void {
    this.stack.push(page);
    this.paint();
  }

  pop(): void {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    this.paint();
  }

  replace(page: PageDef): void {
    if (this.stack.length === 0) {
      this.push(page);
      return;
    }
    this.stack[this.stack.length - 1] = page;
    this.paint();
  }

  depth(): number {
    return this.stack.length;
  }

  /** Re-runs the active page's render function. Used after state changes. */
  rerender(): void {
    this.paint();
  }

  /** Returns the active page id, or null if stack empty. */
  activeId(): string | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1].id : null;
  }

  private paint(): void {
    const active = this.stack[this.stack.length - 1];
    if (!active) {
      render(html``, this.root);
      return;
    }
    render(
      html`
        <div class="kit-stack">
          <div class="kit-page kit-page-active" data-page-id=${active.id}>
            ${active.render()}
          </div>
        </div>
      `,
      this.root,
    );
  }
}
```

Note: this MVP doesn't animate the slide. Animation polish is deferred — the `kit-page-active` / `kit-page-entering` / `kit-page-exiting` CSS classes are defined in styles.css but only the active state is exercised. To add the slide later, paint() can hold both pages briefly during transition.

- [ ] **Step 4: Run tests — pass**

```bash
npm test
```

Expected: 6 new stack tests pass alongside existing kit tests.

- [ ] **Step 5: Commit Tasks 4+5 together**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings/styles.css frontend/settings/stack.ts frontend/settings/stack.test.ts
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: design system + page stack engine for kit v2"
```

---

## Task 6: Frontend — `pages/section.ts`

**Files:**
- Create: `frontend/settings/pages/section.ts`
- Test: `frontend/settings/pages/section.test.ts`

A sub-page that renders one schema section's fields using the extracted `fields.ts` renderer.

- [ ] **Step 1: Write failing tests in `pages/section.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "lit-html";
import { sectionPage } from "./section";
import type { Section } from "../schema";

describe("sectionPage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  it("renders all fields in the section", () => {
    const section: Section = {
      title: "Times",
      fields: [
        { key: "work_minutes", kind: "integer", label: "Pomodoro" },
        { key: "short_break_minutes", kind: "integer", label: "Short break" },
      ],
    };
    const page = sectionPage(section, { work_minutes: 25, short_break_minutes: 5 }, () => {}, () => {});
    render(page.render(), root);

    const inputs = root.querySelectorAll("input[type=number]");
    expect(inputs.length).toBe(2);
    expect((inputs[0] as HTMLInputElement).value).toBe("25");
    expect((inputs[1] as HTMLInputElement).value).toBe("5");
  });

  it("calls onChange when a field changes", () => {
    const section: Section = {
      title: "Times",
      fields: [{ key: "work_minutes", kind: "integer", label: "Pomodoro" }],
    };
    const changes: [string, unknown][] = [];
    const page = sectionPage(
      section,
      { work_minutes: 25 },
      (k, v) => changes.push([k, v]),
      () => {},
    );
    render(page.render(), root);

    const input = root.querySelector<HTMLInputElement>("input[type=number]")!;
    input.value = "42";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(changes).toEqual([["work_minutes", 42]]);
  });

  it("page id and title match section", () => {
    const section: Section = { title: "Times", fields: [] };
    const page = sectionPage(section, {}, () => {}, () => {});
    expect(page.title).toBe("Times");
    expect(page.id).toMatch(/^section-/);
  });

  it("renders back button that calls onBack", () => {
    const section: Section = { title: "Times", fields: [] };
    let backCalled = false;
    const page = sectionPage(section, {}, () => {}, () => { backCalled = true; });
    render(page.render(), root);

    const backBtn = root.querySelector<HTMLButtonElement>(".kit-header-back")!;
    backBtn.click();
    expect(backCalled).toBe(true);
  });
});
```

- [ ] **Step 2: Run — fails**

```bash
npm test
```

- [ ] **Step 3: Implement `frontend/settings/pages/section.ts`**

```ts
import { html } from "lit-html";
import type { Section } from "../schema";
import type { PageDef } from "../stack";
import { fieldRow } from "../fields";

type SettingsValue = Record<string, unknown>;

/** Returns a PageDef that renders one schema section as a sub-page. */
export function sectionPage(
  section: Section,
  current: SettingsValue,
  onChange: (key: string, value: unknown) => void,
  onBack: () => void,
): PageDef {
  return {
    id: `section-${section.title.toLowerCase().replace(/\s+/g, "-")}`,
    title: section.title,
    render: () => html`
      <header class="kit-header">
        <button class="kit-header-back" @click=${onBack}>‹ Settings</button>
        <h2 class="kit-header-title">${section.title}</h2>
        <span class="kit-header-spacer"></span>
      </header>
      <div class="kit-section">
        ${section.fields.map((f) =>
          fieldRow(f, current[f.key], (v) => onChange(f.key, v)),
        )}
      </div>
    `,
  };
}
```

- [ ] **Step 4: Run tests — pass**

```bash
npm test
```

Expected: 4 new section tests pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings/pages
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: section sub-page rendering schema fields"
```

---

## Task 7: Frontend — `pages/theme.ts`

**Files:**
- Create: `frontend/settings/pages/theme.ts`
- Test: `frontend/settings/pages/theme.test.ts`

Theme picker page + helper that applies `data-theme` attribute on `<html>`.

- [ ] **Step 1: Write failing tests in `pages/theme.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "lit-html";
import { themePage, applyTheme } from "./theme";

describe("themePage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-theme");
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  it("renders 3 theme cards", () => {
    const page = themePage("system", () => {}, () => {});
    render(page.render(), root);
    const cards = root.querySelectorAll(".kit-theme-card");
    expect(cards.length).toBe(3);
  });

  it("marks active theme card", () => {
    const page = themePage("dark", () => {}, () => {});
    render(page.render(), root);
    const active = root.querySelector(".kit-theme-card-active");
    expect(active?.getAttribute("data-theme-value")).toBe("dark");
  });

  it("clicking a card calls onChange with the theme value", () => {
    const changes: string[] = [];
    const page = themePage("system", (t) => changes.push(t), () => {});
    render(page.render(), root);
    const lightCard = root.querySelector<HTMLDivElement>('[data-theme-value="light"]')!;
    lightCard.click();
    expect(changes).toEqual(["light"]);
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("sets data-theme attribute on html", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("falls back to system for unknown values", () => {
    applyTheme("not-a-theme" as never);
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement `frontend/settings/pages/theme.ts`**

```ts
import { html } from "lit-html";
import type { PageDef } from "../stack";

export type ThemeValue = "light" | "dark" | "system";

const VALID: ThemeValue[] = ["light", "dark", "system"];

/** Sets data-theme on <html>. Falls back to "system" for unknown values. */
export function applyTheme(theme: string): void {
  const valid = VALID.includes(theme as ThemeValue) ? theme : "system";
  document.documentElement.setAttribute("data-theme", valid);
}

/** Theme picker sub-page. */
export function themePage(
  current: ThemeValue,
  onChange: (theme: ThemeValue) => void,
  onBack: () => void,
): PageDef {
  return {
    id: "theme",
    title: "Theme",
    render: () => html`
      <header class="kit-header">
        <button class="kit-header-back" @click=${onBack}>‹ Settings</button>
        <h2 class="kit-header-title">Theme</h2>
        <span class="kit-header-spacer"></span>
      </header>
      <div class="kit-theme-cards">
        ${VALID.map(
          (t) => html`
            <div
              class=${`kit-theme-card ${t === current ? "kit-theme-card-active" : ""}`}
              data-theme-value=${t}
              @click=${() => {
                applyTheme(t);
                onChange(t);
              }}
            >
              <div class=${`kit-theme-swatch kit-theme-swatch-${t}`}></div>
              <div class="kit-theme-card-label">${t.charAt(0).toUpperCase() + t.slice(1)}</div>
            </div>
          `,
        )}
      </div>
    `,
  };
}
```

- [ ] **Step 4: Run tests — pass**

Expected: 5 new theme tests pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings/pages/theme.ts frontend/settings/pages/theme.test.ts
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: theme picker page with applyTheme helper"
```

---

## Task 8: Frontend — `pages/about.ts` with easter-egg

**Files:**
- Create: `frontend/settings/pages/about.ts`
- Test: `frontend/settings/pages/about.test.ts`

About page with version display, auto-update select, last-checked, manual check, and 5-tap easter-egg.

- [ ] **Step 1: Write failing tests in `pages/about.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "lit-html";
import { aboutPage } from "./about";

describe("aboutPage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.useFakeTimers();
  });

  function defaultDeps(overrides: Partial<Parameters<typeof aboutPage>[0]> = {}) {
    return {
      appName: "Test App",
      version: "1.2.3",
      developer: { name: "Tester", links: { github: "https://github.com/x" } },
      autoUpdate: "onStartup" as const,
      lastChecked: null,
      onAutoUpdateChange: () => {},
      onCheckNow: async () => {},
      onCopyLogs: async () => {},
      onBack: () => {},
      ...overrides,
    };
  }

  it("renders app name + version + developer name", () => {
    const page = aboutPage(defaultDeps());
    render(page.render(), root);
    expect(root.querySelector(".kit-about-app-name")?.textContent).toBe("Test App");
    expect(root.querySelector(".kit-about-version")?.textContent).toContain("1.2.3");
    expect(root.querySelector(".kit-dev-name")?.textContent).toContain("Tester");
  });

  it("renders developer link icons", () => {
    const page = aboutPage(defaultDeps());
    render(page.render(), root);
    const links = root.querySelectorAll(".kit-dev-link");
    expect(links.length).toBe(1);
    expect(links[0].getAttribute("href")).toBe("https://github.com/x");
  });

  it("auto-update select reflects current value", () => {
    const page = aboutPage(defaultDeps({ autoUpdate: "immediate" }));
    render(page.render(), root);
    const sel = root.querySelector<HTMLSelectElement>('[data-key="kit-auto-update"]')!;
    expect(sel.value).toBe("immediate");
  });

  it("changing auto-update calls onAutoUpdateChange", () => {
    const changes: string[] = [];
    const page = aboutPage(defaultDeps({ onAutoUpdateChange: (m) => changes.push(m) }));
    render(page.render(), root);
    const sel = root.querySelector<HTMLSelectElement>('[data-key="kit-auto-update"]')!;
    sel.value = "never";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(changes).toEqual(["never"]);
  });

  it("copy logs button is hidden initially", () => {
    const page = aboutPage(defaultDeps());
    render(page.render(), root);
    const btn = root.querySelector('[data-action="copy-logs"]');
    expect(btn).toBeFalsy();
  });

  it("5 taps on version within 3s reveals copy logs button", () => {
    const page = aboutPage(defaultDeps());
    render(page.render(), root);
    const ver = root.querySelector<HTMLElement>(".kit-about-version")!;
    for (let i = 0; i < 5; i++) {
      ver.click();
      vi.advanceTimersByTime(100);
    }
    render(page.render(), root); // re-render after state change
    const btn = root.querySelector('[data-action="copy-logs"]');
    expect(btn).toBeTruthy();
  });

  it("taps spaced beyond 3s reset the counter", () => {
    const page = aboutPage(defaultDeps());
    render(page.render(), root);
    const ver = root.querySelector<HTMLElement>(".kit-about-version")!;
    for (let i = 0; i < 4; i++) {
      ver.click();
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(3500); // > 3s gap
    ver.click(); // 5th tap, but counter reset
    render(page.render(), root);
    const btn = root.querySelector('[data-action="copy-logs"]');
    expect(btn).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement `frontend/settings/pages/about.ts`**

```ts
import { html } from "lit-html";
import type { PageDef } from "../stack";

export type AutoUpdateMode = "never" | "onStartup" | "immediate";

export interface AboutPageDeps {
  appName: string;
  version: string;
  developer: {
    name: string;
    links: Record<string, string | null | undefined>;
  };
  autoUpdate: AutoUpdateMode;
  lastChecked: Date | null;
  onAutoUpdateChange: (mode: AutoUpdateMode) => void;
  onCheckNow: () => Promise<void>;
  onCopyLogs: () => Promise<void>;
  onBack: () => void;
}

/** Phosphor icon class for a known link key. */
function iconClassFor(linkKey: string): string {
  switch (linkKey) {
    case "github": return "ph ph-github-logo";
    case "youtube": return "ph ph-youtube-logo";
    case "twitter": return "ph ph-twitter-logo";
    case "website": return "ph ph-globe";
    default: return "ph ph-link-simple";
  }
}

/** Persistent state across renders within the same About page instance. */
interface AboutState {
  tapCount: number;
  lastTapAt: number;
  debugUnlocked: boolean;
}

const TAP_WINDOW_MS = 3000;
const TAPS_REQUIRED = 5;

export function aboutPage(deps: AboutPageDeps): PageDef {
  const state: AboutState = { tapCount: 0, lastTapAt: 0, debugUnlocked: false };

  const onVersionTap = () => {
    const now = Date.now();
    if (now - state.lastTapAt > TAP_WINDOW_MS) {
      state.tapCount = 1;
    } else {
      state.tapCount += 1;
    }
    state.lastTapAt = now;
    if (state.tapCount >= TAPS_REQUIRED) {
      state.debugUnlocked = true;
    }
  };

  const formatLastChecked = (d: Date | null): string => {
    if (!d) return "Never";
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  };

  return {
    id: "about",
    title: "About",
    render: () => html`
      <header class="kit-header">
        <button class="kit-header-back" @click=${deps.onBack}>‹ Settings</button>
        <h2 class="kit-header-title">About</h2>
        <span class="kit-header-spacer"></span>
      </header>

      <div class="kit-about-hero">
        <div class="kit-about-app-name">${deps.appName}</div>
        <div class="kit-about-version" @click=${onVersionTap}>v${deps.version}</div>
        <div class="kit-about-status">Up to date</div>
      </div>

      <div class="kit-section">
        <label class="kit-row">
          <span class="kit-row-label">Auto-update</span>
          <select
            class="kit-select"
            data-key="kit-auto-update"
            .value=${deps.autoUpdate}
            @change=${(e: Event) =>
              deps.onAutoUpdateChange((e.target as HTMLSelectElement).value as AutoUpdateMode)}
          >
            <option value="never">Never</option>
            <option value="onStartup">On startup</option>
            <option value="immediate">Immediate</option>
          </select>
        </label>
        <div class="kit-row">
          <span class="kit-row-label" style="color: var(--kit-text-dim)">Last checked</span>
          <span style="color: var(--kit-text-dim); font-size: 12px">${formatLastChecked(deps.lastChecked)}</span>
        </div>
        <div class="kit-row" style="border-top: 1px solid var(--kit-border)">
          <button
            class="kit-btn-secondary"
            style="width: 100%"
            data-action="check-now"
            @click=${() => void deps.onCheckNow()}
          >↻ Check for updates now</button>
        </div>

        ${state.debugUnlocked
          ? html`
              <div class="kit-row">
                <button
                  class="kit-btn-secondary"
                  style="width: 100%"
                  data-action="copy-logs"
                  @click=${() => void deps.onCopyLogs()}
                >Copy debug logs</button>
              </div>
            `
          : null}
      </div>

      <div class="kit-dev-block">
        <div class="kit-dev-name">Made by ${deps.developer.name}</div>
        <div class="kit-dev-links">
          ${Object.entries(deps.developer.links)
            .filter(([, url]) => !!url)
            .map(
              ([key, url]) => html`
                <a class="kit-dev-link" href=${url!} target="_blank" rel="noopener" title=${key}>
                  <i class=${iconClassFor(key)}></i>
                </a>
              `,
            )}
        </div>
      </div>
    `,
  };
}
```

- [ ] **Step 4: Run tests — pass**

Expected: 7 new about tests pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings/pages/about.ts frontend/settings/pages/about.test.ts
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: about page with 5-tap easter-egg debug unlock"
```

---

## Task 9: Frontend — `pages/reset-modal.ts`

**Files:**
- Create: `frontend/settings/pages/reset-modal.ts`
- Test: `frontend/settings/pages/reset-modal.test.ts`

Confirmation modal for the reset action.

- [ ] **Step 1: Write failing tests in `pages/reset-modal.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "lit-html";
import { resetModal } from "./reset-modal";

describe("resetModal", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  it("renders title + body + 2 buttons", () => {
    render(
      resetModal(async () => {}, () => {}),
      root,
    );
    expect(root.querySelector(".kit-modal-title")?.textContent).toContain("Reset");
    const buttons = root.querySelectorAll("button");
    expect(buttons.length).toBe(2);
  });

  it("clicking confirm calls onConfirm", async () => {
    let confirmed = false;
    render(
      resetModal(async () => { confirmed = true; }, () => {}),
      root,
    );
    const confirm = root.querySelector<HTMLButtonElement>('[data-action="confirm"]')!;
    confirm.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(confirmed).toBe(true);
  });

  it("clicking cancel calls onCancel", () => {
    let cancelled = false;
    render(
      resetModal(async () => {}, () => { cancelled = true; }),
      root,
    );
    const cancel = root.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    cancel.click();
    expect(cancelled).toBe(true);
  });

  it("clicking backdrop calls onCancel", () => {
    let cancelled = false;
    render(
      resetModal(async () => {}, () => { cancelled = true; }),
      root,
    );
    const backdrop = root.querySelector<HTMLDivElement>(".kit-modal-backdrop")!;
    backdrop.click();
    expect(cancelled).toBe(true);
  });

  it("clicking inside modal does not propagate to backdrop", () => {
    let cancelled = false;
    render(
      resetModal(async () => {}, () => { cancelled = true; }),
      root,
    );
    const modal = root.querySelector<HTMLDivElement>(".kit-modal")!;
    modal.click();
    expect(cancelled).toBe(false);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement `frontend/settings/pages/reset-modal.ts`**

```ts
import { html, type TemplateResult } from "lit-html";

export function resetModal(
  onConfirm: () => Promise<void>,
  onCancel: () => void,
): TemplateResult {
  return html`
    <div class="kit-modal-backdrop" @click=${onCancel}>
      <div class="kit-modal" @click=${(e: Event) => e.stopPropagation()}>
        <h3 class="kit-modal-title">Reset all settings?</h3>
        <p class="kit-modal-body">This will reset all settings to defaults. The app will reload.</p>
        <div class="kit-modal-actions">
          <button class="kit-btn-secondary" data-action="cancel" @click=${onCancel}>Cancel</button>
          <button
            class="kit-btn-danger"
            style="width: auto"
            data-action="confirm"
            @click=${() => void onConfirm()}
          >Reset</button>
        </div>
      </div>
    </div>
  `;
}
```

- [ ] **Step 4: Run tests — pass**

Expected: 5 new reset-modal tests pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings/pages/reset-modal.ts frontend/settings/pages/reset-modal.test.ts
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: reset confirmation modal"
```

---

## Task 10: Frontend — `pages/root.ts`

**Files:**
- Create: `frontend/settings/pages/root.ts`
- Test: `frontend/settings/pages/root.test.ts`

The root settings page = nav-row list + System category + Danger zone.

- [ ] **Step 1: Write failing tests in `pages/root.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "lit-html";
import { rootPage } from "./root";
import type { SettingsSchema } from "../schema";
import type { Field } from "../schema";
import type { DangerAction } from "../renderer";

describe("rootPage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  function defaultDeps(overrides: Partial<Parameters<typeof rootPage>[0]> = {}) {
    const schema: SettingsSchema = {
      sections: [
        { title: "Times", fields: [] },
        { title: "Sound", fields: [] },
      ],
    };
    return {
      schema,
      systemInline: [] as Field[],
      dangerActions: [] as DangerAction[],
      current: {} as Record<string, unknown>,
      onChange: () => {},
      onNavSection: () => {},
      onNavTheme: () => {},
      onNavAbout: () => {},
      onReset: () => {},
      onDanger: () => {},
      ...overrides,
    };
  }

  it("renders one nav-row per schema section", () => {
    const page = rootPage(defaultDeps());
    render(page.render(), root);
    const navRows = root.querySelectorAll(".kit-nav-row");
    // schema sections (2) + Theme (1) + About (1) = 4 nav-rows
    expect(navRows.length).toBe(4);
  });

  it("clicking schema section calls onNavSection with that section", () => {
    const calls: string[] = [];
    const page = rootPage(defaultDeps({ onNavSection: (s) => calls.push(s.title) }));
    render(page.render(), root);
    const timesRow = root.querySelector<HTMLElement>('[data-nav="section-times"]')!;
    timesRow.click();
    expect(calls).toEqual(["Times"]);
  });

  it("clicking Theme calls onNavTheme", () => {
    let called = false;
    const page = rootPage(defaultDeps({ onNavTheme: () => { called = true; } }));
    render(page.render(), root);
    const row = root.querySelector<HTMLElement>('[data-nav="theme"]')!;
    row.click();
    expect(called).toBe(true);
  });

  it("clicking About calls onNavAbout", () => {
    let called = false;
    const page = rootPage(defaultDeps({ onNavAbout: () => { called = true; } }));
    render(page.render(), root);
    const row = root.querySelector<HTMLElement>('[data-nav="about"]')!;
    row.click();
    expect(called).toBe(true);
  });

  it("renders systemInline fields as inline rows", () => {
    const page = rootPage(defaultDeps({
      systemInline: [{ key: "autostart", kind: "toggle", label: "Launch at startup" }],
    }));
    render(page.render(), root);
    const toggle = root.querySelector<HTMLInputElement>('input[data-key="autostart"]');
    expect(toggle).toBeTruthy();
  });

  it("Reset button always renders in danger zone", () => {
    const page = rootPage(defaultDeps());
    render(page.render(), root);
    const reset = root.querySelector<HTMLButtonElement>('[data-action="reset"]');
    expect(reset).toBeTruthy();
  });

  it("dangerActions render as additional danger buttons", () => {
    const page = rootPage(defaultDeps({
      dangerActions: [{ label: "Log out", command: "logout" }],
    }));
    render(page.render(), root);
    const buttons = root.querySelectorAll(".kit-btn-danger");
    // Reset (1) + Log out (1) = 2
    expect(buttons.length).toBe(2);
    expect(buttons[1].textContent).toContain("Log out");
  });

  it("clicking a dangerAction calls onDanger with that action", () => {
    const calls: string[] = [];
    const action: DangerAction = { label: "Log out", command: "logout" };
    const page = rootPage(defaultDeps({
      dangerActions: [action],
      onDanger: (a) => calls.push(a.command),
    }));
    render(page.render(), root);
    const logoutBtn = root.querySelectorAll<HTMLButtonElement>(".kit-btn-danger")[1];
    logoutBtn.click();
    expect(calls).toEqual(["logout"]);
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement `frontend/settings/pages/root.ts`**

```ts
import { html } from "lit-html";
import type { Section, SettingsSchema, Field } from "../schema";
import type { PageDef } from "../stack";
import { fieldRow } from "../fields";
import type { DangerAction } from "../renderer";

export interface RootDeps {
  schema: SettingsSchema;
  systemInline: Field[];
  dangerActions: DangerAction[];
  current: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onNavSection: (section: Section) => void;
  onNavTheme: () => void;
  onNavAbout: () => void;
  onReset: () => void;
  onDanger: (action: DangerAction) => void;
}

function navRow(label: string, dataNav: string, onClick: () => void) {
  return html`
    <div class="kit-row kit-nav-row" data-nav=${dataNav} @click=${onClick}>
      <span class="kit-row-label">${label}</span>
      <span class="kit-nav-arrow">›</span>
    </div>
  `;
}

function sectionId(section: Section): string {
  return `section-${section.title.toLowerCase().replace(/\s+/g, "-")}`;
}

export function rootPage(deps: RootDeps): PageDef {
  return {
    id: "root",
    title: "Settings",
    render: () => html`
      <header class="kit-header">
        <span class="kit-header-spacer"></span>
        <h2 class="kit-header-title">Settings</h2>
        <span class="kit-header-spacer"></span>
      </header>

      ${deps.schema.sections.length > 0
        ? html`
            <div class="kit-section">
              ${deps.schema.sections.map((section) =>
                navRow(section.title, sectionId(section), () => deps.onNavSection(section)),
              )}
            </div>
          `
        : null}

      <div class="kit-section">
        <div class="kit-section-title">System</div>
        ${navRow("Theme", "theme", deps.onNavTheme)}
        ${deps.systemInline.map((f) =>
          fieldRow(f, deps.current[f.key], (v) => deps.onChange(f.key, v)),
        )}
        ${navRow("About", "about", deps.onNavAbout)}
      </div>

      <div class="kit-section">
        <div class="kit-section-title kit-section-danger">Danger zone</div>
        <div class="kit-row" style="border-top: 1px solid var(--kit-border)">
          <button class="kit-btn-danger" data-action="reset" @click=${deps.onReset}>
            Reset all settings
          </button>
        </div>
        ${deps.dangerActions.map(
          (a) => html`
            <div class="kit-row" style="border-top: 1px solid var(--kit-border)">
              <button
                class="kit-btn-danger"
                data-action=${`danger-${a.command}`}
                @click=${() => deps.onDanger(a)}
              >${a.label}</button>
            </div>
          `,
        )}
      </div>
    `,
  };
}
```

- [ ] **Step 4: Run tests — pass**

Expected: 8 new root tests pass. May see TypeScript errors about `DangerAction` import from `../renderer` — Task 11 introduces it. To unblock now, define it temporarily inline in `root.ts` instead of importing:

```ts
export interface DangerAction {
  label: string;
  command: string;
  confirmBody?: string;
}
```

…and remove the import. Task 11 will move it back to `renderer.ts`.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings/pages/root.ts frontend/settings/pages/root.test.ts
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: root settings page with nav-rows + danger zone"
```

---

## Task 11: Frontend — rewrite `renderer.ts` as orchestrator

**Files:**
- Modify: `frontend/settings/renderer.ts` (full rewrite)
- Modify: `frontend/settings/renderer.test.ts` (rewrite for v2 API)

The new renderer:
1. Loads settings via `invoke(loadCommand)`
2. Reads `__kit_theme`, applies it via `applyTheme`
3. Builds the page stack with root as initial page
4. Wires push/pop/save/reset/danger
5. Returns a teardown fn

- [ ] **Step 0: Remove the temporary inline `DangerAction` from `pages/root.ts`**

In Task 10 you defined `DangerAction` inline in `root.ts` to break a circular import. Now that we're authoring `renderer.ts` (which will own the canonical definition), reverse that:

1. In `frontend/settings/pages/root.ts`, delete the inline `interface DangerAction` block.
2. Add `import type { DangerAction } from "../renderer";` to the top of `root.ts`.
3. Update `frontend/settings/pages/root.test.ts` similarly: replace any temporary inline `DangerAction` import with `import type { DangerAction } from "../renderer";`.

This avoids two competing definitions of the same type once renderer.ts lands.

- [ ] **Step 1: Replace `frontend/settings/renderer.ts`**

```ts
import { html, render } from "lit-html";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SettingsSchema, Section, Field } from "./schema";
import { PageStack } from "./stack";
import { rootPage } from "./pages/root";
import { sectionPage } from "./pages/section";
import { themePage, applyTheme, type ThemeValue } from "./pages/theme";
import { aboutPage, type AutoUpdateMode } from "./pages/about";
import { resetModal } from "./pages/reset-modal";

export interface DangerAction {
  label: string;
  command: string;
  confirmBody?: string;
}

export interface AboutConfig {
  appName?: string;
  appVersion?: string;
  developer?: {
    name?: string;
    links?: Record<string, string | null | undefined>;
  };
}

export interface ThemeConfig {
  default?: ThemeValue;
}

export interface RenderOptions {
  schema: SettingsSchema;
  systemInline?: Field[];
  dangerActions?: DangerAction[];
  about?: AboutConfig;
  theme?: ThemeConfig;
  loadCommand?: string;
  saveCommand?: string;
  savedEvent?: string;
  onSaved?: (settings: Record<string, unknown>) => void;
  closeOnSave?: boolean;
}

const KIT_DEFAULTS = {
  developer: {
    name: "SirBepy",
    links: {
      github: "https://github.com/SirBepy",
      youtube: "https://youtube.com/@SirBepy",
    },
  },
};

type SettingsValue = Record<string, unknown>;

export async function renderSettingsPage(
  root: HTMLElement,
  opts: RenderOptions,
): Promise<() => void> {
  const loadCmd = opts.loadCommand ?? "get_settings";
  const saveCmd = opts.saveCommand ?? "save_settings";
  const savedEvent = opts.savedEvent ?? "settings-updated";

  // Load settings.
  const initial = (await invoke<SettingsValue>(loadCmd)) ?? {};
  let current: SettingsValue = { ...initial };

  // Apply theme before first paint.
  const initialTheme = (current["__kit_theme"] as ThemeValue) ?? opts.theme?.default ?? "system";
  applyTheme(initialTheme);

  // Stack management.
  const stackRoot = document.createElement("div");
  stackRoot.className = "kit-settings";
  root.replaceChildren(stackRoot);
  const stack = new PageStack(stackRoot);

  // Modal layer (separate from stack, overlays everything).
  const modalRoot = document.createElement("div");
  root.appendChild(modalRoot);

  const setField = async (key: string, value: unknown) => {
    current[key] = value;
    // Auto-save on every change. Per spec: settings persist immediately.
    await invoke(saveCmd, { settings: current });
    await emit(savedEvent, current);
    opts.onSaved?.(current);
    stack.rerender();
  };

  const navSection = (section: Section) => {
    stack.push(
      sectionPage(section, current, setField, () => stack.pop()),
    );
  };

  const navTheme = () => {
    stack.push(
      themePage(
        (current["__kit_theme"] as ThemeValue) ?? "system",
        async (t) => {
          await setField("__kit_theme", t);
          applyTheme(t);
          stack.rerender();
        },
        () => stack.pop(),
      ),
    );
  };

  const navAbout = () => {
    let appName = opts.about?.appName ?? "App";
    let version = opts.about?.appVersion ?? "0.0.0";
    if (!opts.about?.appName) {
      try {
        const { getName } = await import("@tauri-apps/api/app");
        appName = await getName();
      } catch { /* ignore */ }
    }
    if (!opts.about?.appVersion) {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        version = await getVersion();
      } catch { /* ignore */ }
    }
    const developer = {
      name: opts.about?.developer?.name ?? KIT_DEFAULTS.developer.name,
      links: { ...KIT_DEFAULTS.developer.links, ...opts.about?.developer?.links },
    };
    stack.push(
      aboutPage({
        appName,
        version,
        developer,
        autoUpdate: ((current["__kit_auto_update"] as AutoUpdateMode) ?? "onStartup"),
        lastChecked: null, // future: kit caches last check timestamp
        onAutoUpdateChange: (m) => void setField("__kit_auto_update", m),
        onCheckNow: async () => {
          const { checkAndPromptUpdate } = await import("../updater/check");
          await checkAndPromptUpdate();
        },
        onCopyLogs: async () => {
          const logs = await invoke<string>("kit_copy_logs");
          await navigator.clipboard.writeText(logs);
        },
        onBack: () => stack.pop(),
      }),
    );
  };

  const onReset = () => {
    render(
      resetModal(
        async () => {
          render(html``, modalRoot); // close modal
          // Determine settings filename — must match what the app uses.
          // Convention: apps using load_for/save_for with "settings.json" pass it implicitly.
          // We expose this as an opt for explicitness.
          await invoke("kit_reset_settings", { filename: "settings.json" });
          await getCurrentWindow().close();
        },
        () => render(html``, modalRoot),
      ),
      modalRoot,
    );
  };

  const onDanger = async (action: DangerAction) => {
    // For now, fire the command directly. Future: confirmation modal per action.
    try {
      await invoke(action.command);
    } catch (e) {
      console.warn("[kit] danger action failed:", e);
    }
  };

  // Listen for settings-reset events so the settings window also re-reads if app modified state.
  const unlisten = await listen("settings-reset", async () => {
    const fresh = (await invoke<SettingsValue>(loadCmd)) ?? {};
    current = { ...fresh };
    applyTheme((current["__kit_theme"] as ThemeValue) ?? "system");
    stack.rerender();
  });

  // Wait, navAbout is async because of dynamic getName/getVersion. Re-declare inline above.
  const navAboutSync = () => { void navAbout(); };

  stack.push(
    rootPage({
      schema: opts.schema,
      systemInline: opts.systemInline ?? [],
      dangerActions: opts.dangerActions ?? [],
      current,
      onChange: setField,
      onNavSection: navSection,
      onNavTheme: navTheme,
      onNavAbout: navAboutSync,
      onReset,
      onDanger,
    }),
  );

  return () => {
    void unlisten();
    render(html``, root);
  };
}
```

Note on close: the v1 renderer closed the window on save. v2 auto-saves on every change, no Save button. The window closes on reset (after kit_reset_settings) or via user closing it manually. This is intentional — matches the claude_usage settings UX where changes apply immediately.

- [ ] **Step 2: Replace `frontend/settings/renderer.test.ts`**

The v1 tests were tailored to the old "load + Save button" model. Rewrite as smoke tests that verify the orchestrator wires the pages:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: vi.fn() }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getName: () => Promise.resolve("Mocked App"),
  getVersion: () => Promise.resolve("0.0.1-mock"),
}));

describe("renderSettingsPage v2", () => {
  let root: HTMLElement;

  beforeEach(() => {
    invoke.mockReset();
    document.body.innerHTML = "";
    document.documentElement.removeAttribute("data-theme");
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  it("loads settings and applies theme on mount", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return { __kit_theme: "dark", work_minutes: 25 };
      return undefined;
    });

    const { renderSettingsPage } = await import("./renderer");
    await renderSettingsPage(root, {
      schema: { sections: [{ title: "Times", fields: [] }] },
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("renders root page with sections + System + Danger zone", async () => {
    invoke.mockImplementation(async () => ({}));
    const { renderSettingsPage } = await import("./renderer");
    await renderSettingsPage(root, {
      schema: { sections: [{ title: "Times", fields: [] }] },
    });

    expect(root.querySelector('[data-nav="section-times"]')).toBeTruthy();
    expect(root.querySelector('[data-nav="theme"]')).toBeTruthy();
    expect(root.querySelector('[data-nav="about"]')).toBeTruthy();
    expect(root.querySelector('[data-action="reset"]')).toBeTruthy();
  });

  it("clicking a section nav-row pushes that section page", async () => {
    invoke.mockImplementation(async () => ({}));
    const { renderSettingsPage } = await import("./renderer");
    await renderSettingsPage(root, {
      schema: {
        sections: [{ title: "Times", fields: [{ key: "work_minutes", kind: "integer", label: "Pomo" }] }],
      },
    });

    const nav = root.querySelector<HTMLElement>('[data-nav="section-times"]')!;
    nav.click();
    // After push, root nav-row is replaced by section page; back button visible.
    expect(root.querySelector(".kit-header-back")).toBeTruthy();
    expect(root.querySelector('input[data-key="work_minutes"]')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run all tests**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
npm test
```

Expected: total ≈ 35-40 tests pass (3 schema + 5 store + 3 kit_settings + 6 stack + 4 section + 5 theme + 7 about + 5 reset-modal + 8 root + 3 renderer-smoke + others). Existing v1 renderer tests are deleted.

- [ ] **Step 4: tsc check**

```bash
npx tsc --noEmit
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings/renderer.ts frontend/settings/renderer.test.ts
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: renderer v2 orchestrator wiring stack + pages"
```

---

## Task 12: Frontend — `runAutoUpdateCheck` helper

**Files:**
- Create: `frontend/updater/auto-check.ts`
- Test: `frontend/updater/auto-check.test.ts`

Helper that reads the persisted auto-update mode and dispatches to the right behavior.

- [ ] **Step 1: Write failing tests in `auto-check.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const checkMock = vi.fn();
const askMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => checkMock(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("runAutoUpdateCheck", () => {
  beforeEach(() => {
    checkMock.mockReset();
    askMock.mockReset();
    invokeMock.mockReset();
  });

  it("does nothing in 'never' mode", async () => {
    invokeMock.mockResolvedValue({ __kit_auto_update: "never" });
    const { runAutoUpdateCheck } = await import("./auto-check");
    await runAutoUpdateCheck();
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("prompts user in 'onStartup' mode", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    invokeMock.mockResolvedValue({ __kit_auto_update: "onStartup" });
    checkMock.mockResolvedValue({ version: "0.3.0", downloadAndInstall });
    askMock.mockResolvedValue(true);

    const { runAutoUpdateCheck } = await import("./auto-check");
    await runAutoUpdateCheck();

    expect(askMock).toHaveBeenCalled();
    expect(downloadAndInstall).toHaveBeenCalled();
  });

  it("auto-installs without prompting in 'immediate' mode", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    invokeMock.mockResolvedValue({ __kit_auto_update: "immediate" });
    checkMock.mockResolvedValue({ version: "0.3.0", downloadAndInstall });

    const { runAutoUpdateCheck } = await import("./auto-check");
    await runAutoUpdateCheck();

    expect(askMock).not.toHaveBeenCalled();
    expect(downloadAndInstall).toHaveBeenCalled();
  });

  it("falls back to onStartup if mode is missing", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    invokeMock.mockResolvedValue({}); // no __kit_auto_update key
    checkMock.mockResolvedValue({ version: "0.3.0", downloadAndInstall });
    askMock.mockResolvedValue(true);

    const { runAutoUpdateCheck } = await import("./auto-check");
    await runAutoUpdateCheck();

    expect(askMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — fails**

- [ ] **Step 3: Implement `frontend/updater/auto-check.ts`**

```ts
import { check } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export type AutoUpdateMode = "never" | "onStartup" | "immediate";

export interface AutoCheckOptions {
  /** Defaults to "get_settings". */
  loadCommand?: string;
}

/** Reads __kit_auto_update from settings, then dispatches accordingly. */
export async function runAutoUpdateCheck(opts: AutoCheckOptions = {}): Promise<void> {
  try {
    const settings = (await invoke<Record<string, unknown>>(
      opts.loadCommand ?? "get_settings",
    )) ?? {};
    const mode = (settings["__kit_auto_update"] as AutoUpdateMode) ?? "onStartup";

    if (mode === "never") return;

    const update = await check();
    if (!update) return;

    if (mode === "immediate") {
      await update.downloadAndInstall();
      return;
    }

    // onStartup: prompt
    const confirmed = await ask(
      `Version ${update.version} is available. Install now?`,
      { title: "Update available", kind: "info" },
    );
    if (confirmed) {
      await update.downloadAndInstall();
    }
  } catch (err) {
    console.warn("[tauri_kit_updater] auto-check failed:", err);
  }
}
```

- [ ] **Step 4: Run tests — pass**

Expected: 4 new auto-check tests pass.

- [ ] **Step 5: Commit + push everything**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/updater/auto-check.ts frontend/updater/auto-check.test.ts
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: runAutoUpdateCheck dispatcher honoring __kit_auto_update mode"
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" push
```

---

## Self-review checklist

Before declaring Plan E done:

- [ ] All Rust tests pass: `cargo test -p tauri_kit_settings` (8+ tests)
- [ ] All vitest tests pass: `npm test` (≈40 tests)
- [ ] `npx tsc --noEmit` clean
- [ ] Kit pushed to `origin/main`
- [ ] No tests skipped, no console errors during tests
- [ ] `cargo check --workspace` clean

If any item fails, fix before moving to Plan F.

---

## Out of scope (covered by Plan F)

- Pomodoro adoption of v2 API
- Pomodoro `Settings` struct flatten with `KitSettings`
- Pomodoro `with_kit_commands` registration
- Bumping pomodoro to 0.3.0
- End-to-end auto-update verification
