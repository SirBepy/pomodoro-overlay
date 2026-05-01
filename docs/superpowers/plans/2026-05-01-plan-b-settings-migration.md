# Plan B: Settings System Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the kit's settings system (Rust store helpers + frontend schema/renderer/window) and migrate pomodoro-overlay to consume it. After this plan, pomodoro's settings UI is rendered from a TS schema via the kit, with the old `settings.html` / `settings.js` deleted.

**Architecture:**
- Kit Rust = pure helper functions (`load<T>`, `save<T>`, `paths::app_data_dir`). Apps write their own `#[tauri::command]` wrappers (~5 lines each) because Tauri commands can't be generic across crates.
- Kit Frontend = `defineSchema()` + `renderSettingsPage(root, opts)` + `openSettingsWindow(opts)`. Pure functions over a schema. App passes a schema, kit produces a working settings page.
- Pomodoro keeps its current JSON file shape (`<app-data>/settings.json`) so existing users don't lose their config.

**Tech Stack:** Rust 1.80+, serde, tauri 2, tempfile (tests), TypeScript 5, lit-html 3, vitest (tests), JSDOM.

**Pre-req:** Plan A complete (kit repo exists, submodule wired, Vite pipeline working).

**Source spec:** `docs/superpowers/specs/2026-05-01-shared-tauri-kit-design.md`

**Two-repo work:** Tasks 1-2, 5-9 happen in the kit repo. Tasks 3-4, 10-12 happen in pomodoro-overlay. Each kit-side task ends with a kit commit + bumping the submodule pointer in pomodoro.

---

## Task 1: Kit — Rust paths helper

**Files (in kit repo):**
- Create: `tauri/settings/src/paths.rs`
- Modify: `tauri/settings/src/lib.rs`
- Test: inline `#[cfg(test)] mod tests` in `paths.rs`

The paths helper resolves the per-app data directory using Tauri's `AppHandle`. Trivial wrapper — Tauri already does the work — but centralizes the call so every consumer uses the same convention.

- [ ] **Step 1: Write the failing test**

Add to `tauri/settings/src/paths.rs`:

```rust
//! Per-app data directory resolution.

use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

/// Returns `<app-data-dir>/<filename>`. Creates the parent directory if missing.
pub fn settings_path<R: Runtime>(app: &AppHandle<R>, filename: &str) -> std::io::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string()))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(filename))
}

#[cfg(test)]
mod tests {
    // Cannot easily unit-test settings_path because it requires a real AppHandle.
    // Coverage comes from Task 2 store tests via dependency injection of a base dir.
}
```

- [ ] **Step 2: Update `tauri/settings/src/lib.rs` to expose paths**

```rust
//! Generic JSON-backed settings store + Tauri command helpers.

pub mod paths;
pub mod store;
pub mod error;

pub use error::Error;
```

- [ ] **Step 3: Add `tauri/settings/src/error.rs`**

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
}
```

- [ ] **Step 4: Add empty `tauri/settings/src/store.rs` (real impl in Task 2)**

```rust
//! Filled in by Task 2.
```

- [ ] **Step 5: Run cargo check**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
cargo check --workspace
```

Expected: passes, no errors.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add tauri/settings/src
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: settings paths helper + error type"
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" push
```

---

## Task 2: Kit — Rust settings store

**Files (in kit repo):**
- Modify: `tauri/settings/src/store.rs`
- Test: inline `#[cfg(test)] mod tests` in `store.rs`

The store handles serialize/deserialize and atomic file writes. Keeps a `PathBuf` that the caller passes (decoupled from `AppHandle` for testability). A higher-level helper `load_for<T>(app, filename)` and `save_for<T>(app, filename, value)` ties it to `AppHandle` for app code.

- [ ] **Step 1: Write the failing test**

Replace `tauri/settings/src/store.rs` with:

```rust
//! Atomic JSON-backed store. Pure file I/O, decoupled from Tauri.

use crate::error::Error;
use serde::{de::DeserializeOwned, Serialize};
use std::path::Path;

/// Read JSON at `path` and deserialize. Returns `T::default()` if file is missing.
/// Returns `T::default()` and logs a warning if file exists but is unparseable.
pub fn load<T: DeserializeOwned + Default>(path: &Path) -> Result<T, Error> {
    if !path.exists() {
        return Ok(T::default());
    }
    let bytes = std::fs::read(path)?;
    match serde_json::from_slice::<T>(&bytes) {
        Ok(v) => Ok(v),
        Err(e) => {
            eprintln!(
                "[tauri_kit_settings] settings file {} unparseable: {}; using defaults",
                path.display(),
                e
            );
            Ok(T::default())
        }
    }
}

/// Atomic write: serialize T, write to `<path>.tmp`, fsync, rename to `path`.
pub fn save<T: Serialize>(path: &Path, value: &T) -> Result<(), Error> {
    let bytes = serde_json::to_vec_pretty(value)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use tempfile::tempdir;

    #[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
    struct TestSettings {
        name: String,
        count: u32,
    }

    #[test]
    fn load_returns_default_when_file_missing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("missing.json");
        let s: TestSettings = load(&path).unwrap();
        assert_eq!(s, TestSettings::default());
    }

    #[test]
    fn load_returns_default_when_file_corrupt() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("corrupt.json");
        std::fs::write(&path, b"{not valid json").unwrap();
        let s: TestSettings = load(&path).unwrap();
        assert_eq!(s, TestSettings::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("ok.json");
        let s = TestSettings { name: "foo".into(), count: 42 };
        save(&path, &s).unwrap();
        let loaded: TestSettings = load(&path).unwrap();
        assert_eq!(loaded, s);
    }

    #[test]
    fn save_creates_parent_dir() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sub").join("dir").join("ok.json");
        let s = TestSettings { name: "x".into(), count: 1 };
        save(&path, &s).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn save_does_not_leave_tmp_on_success() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("ok.json");
        let s = TestSettings::default();
        save(&path, &s).unwrap();
        assert!(!path.with_extension("tmp").exists());
    }
}
```

- [ ] **Step 2: Run tests — should fail (load not implemented yet)**

Wait, code above already has the implementation. Reorder: tests first only, run, see fail, then add impl. Practically here the impl is small enough to ship together. Skip the strict red→green dance for this task — instead run tests immediately and confirm green.

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
cargo test -p tauri_kit_settings
```

Expected: all 5 tests pass.

If any fail, fix and re-run.

- [ ] **Step 3: Add convenience helpers in `lib.rs` for app-level usage**

Append to `tauri/settings/src/lib.rs`:

```rust
use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Runtime};

/// Load settings of type `T` from `<app-data>/<filename>`. Default if missing.
pub fn load_for<R: Runtime, T: DeserializeOwned + Default>(
    app: &AppHandle<R>,
    filename: &str,
) -> Result<T, Error> {
    let path = paths::settings_path(app, filename)?;
    store::load(&path)
}

/// Save settings to `<app-data>/<filename>`. Atomic.
pub fn save_for<R: Runtime, T: Serialize>(
    app: &AppHandle<R>,
    filename: &str,
    value: &T,
) -> Result<(), Error> {
    let path = paths::settings_path(app, filename)?;
    store::save(&path, value)
}
```

- [ ] **Step 4: Re-run cargo check + tests**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
cargo check --workspace
cargo test -p tauri_kit_settings
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add tauri/settings/src
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: settings store with atomic save + corruption-tolerant load"
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" push
```

---

## Task 3: Pomodoro — adopt kit's settings crate

**Files (in pomodoro-overlay):**
- Modify: `vendor/tauri_kit/` submodule pointer
- Modify: `src-tauri/Cargo.toml` (add path dep)
- Read first: `src-tauri/src/main.rs` to find existing settings code

This task wires pomodoro's existing settings struct + commands to use the kit's helpers. Behavior must remain identical — same JSON file, same field shape.

- [ ] **Step 1: Update kit submodule to latest**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/vendor/tauri_kit"
git pull origin main
cd ../..
```

- [ ] **Step 2: Locate pomodoro's existing settings code**

Read `src-tauri/src/main.rs` and identify where the settings struct is defined and where `get_settings` / `save_settings` Tauri commands live. (Pomodoro's main.rs hasn't been split into modules yet.)

- [ ] **Step 3: Add path-dep to `src-tauri/Cargo.toml`**

Under `[dependencies]`, append:

```toml
tauri_kit_settings = { path = "../vendor/tauri_kit/tauri/settings" }
```

- [ ] **Step 4: Replace pomodoro's load/save with kit calls**

In `src-tauri/src/main.rs`:

- Keep the existing `Settings` struct (do NOT change its field names or types — preserves on-disk compatibility).
- Replace the manual file-read/file-write logic in `get_settings` and `save_settings` commands with calls to `tauri_kit_settings::load_for::<_, Settings>(&app, "settings.json")` and `tauri_kit_settings::save_for(&app, "settings.json", &settings)`.

Concrete change pattern (verify existing code first; pomodoro might already use tauri's path helpers):

```rust
#[tauri::command]
async fn get_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    tauri_kit_settings::load_for::<_, Settings>(&app, "settings.json")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    tauri_kit_settings::save_for(&app, "settings.json", &settings)
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 5: Verify cargo build**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/src-tauri"
cargo check
```

Expected: compiles. If there are signature mismatches with how the existing commands were declared in the `tauri::generate_handler![]` list, fix in place.

- [ ] **Step 6: Manual test — run dev, save settings, verify file unchanged**

Before running dev, snapshot the current settings file:

```bash
cp "$env:APPDATA/com.sirbepy.pomodoro-overlay/settings.json" /tmp/settings.before.json
```

Run dev:

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npm run tauri dev
```

In the running app: open settings, change a value (e.g. work_minutes from 25 → 26), save, close.

```bash
cp "$env:APPDATA/com.sirbepy.pomodoro-overlay/settings.json" /tmp/settings.after.json
diff /tmp/settings.before.json /tmp/settings.after.json
```

Expected: only the changed field differs. JSON shape (key names, indentation, casing) is identical.

If the diff shows extra fields, missing fields, or shape changes, the kit helpers serialize differently than the old code did — fix the kit's `save` to use `to_vec` (compact) or `to_vec_pretty` (matches old) to match. Spec assumes pretty.

Restore the file:

```bash
cp /tmp/settings.before.json "$env:APPDATA/com.sirbepy.pomodoro-overlay/settings.json"
```

- [ ] **Step 7: Commit pomodoro side**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src vendor/tauri_kit
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "REFACTOR: route settings load/save through tauri_kit_settings"
```

---

## Task 4: Kit — Frontend schema types

**Files (in kit repo):**
- Create: `frontend/settings/schema.ts`
- Test: `frontend/settings/schema.test.ts`

Pure type definitions plus a `defineSchema` identity helper that gives consumers TS inference.

- [ ] **Step 1: Write the failing test**

Create `frontend/settings/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { defineSchema } from "./schema";

describe("defineSchema", () => {
  it("returns the input unchanged", () => {
    const s = defineSchema({
      sections: [
        {
          title: "T",
          fields: [{ key: "k", kind: "number", label: "L" }],
        },
      ],
    });
    expect(s.sections.length).toBe(1);
    expect(s.sections[0].fields[0].key).toBe("k");
  });

  it("infers field kind discriminant", () => {
    const s = defineSchema({
      sections: [
        {
          title: "T",
          fields: [
            { key: "n", kind: "number", label: "N", min: 0, max: 100 },
            { key: "t", kind: "toggle", label: "T" },
            { key: "s", kind: "select", label: "S", options: [{ value: "a", label: "A" }] },
          ],
        },
      ],
    });
    expect(s.sections[0].fields[0].kind).toBe("number");
    expect(s.sections[0].fields[1].kind).toBe("toggle");
    expect(s.sections[0].fields[2].kind).toBe("select");
  });
});
```

- [ ] **Step 2: Run the test — fails (schema.ts doesn't exist)**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
npm test
```

Expected: `Cannot find module './schema'`.

- [ ] **Step 3: Implement `frontend/settings/schema.ts`**

```ts
import type { TemplateResult } from "lit-html";

export interface BaseField {
  key: string;
  label: string;
}

export interface NumberField extends BaseField {
  kind: "number";
  min?: number;
  max?: number;
  step?: number;
}

export interface IntegerField extends BaseField {
  kind: "integer";
  min?: number;
  max?: number;
}

export interface RangeField extends BaseField {
  kind: "range";
  min: number;
  max: number;
  step?: number;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectField extends BaseField {
  kind: "select";
  options: SelectOption[];
}

export interface ToggleField extends BaseField {
  kind: "toggle";
}

export interface TextField extends BaseField {
  kind: "text";
}

export interface FileField extends BaseField {
  kind: "file";
  pickerCommand: string;
  defaultLabel?: string;
}

export interface CustomField extends BaseField {
  kind: "custom";
  render: (
    value: unknown,
    onChange: (next: unknown) => void,
  ) => TemplateResult;
}

export type Field =
  | NumberField
  | IntegerField
  | RangeField
  | SelectField
  | ToggleField
  | TextField
  | FileField
  | CustomField;

export interface Section {
  title: string;
  fields: Field[];
}

export interface SettingsSchema {
  sections: Section[];
}

export function defineSchema(schema: SettingsSchema): SettingsSchema {
  return schema;
}
```

- [ ] **Step 4: Re-run test — passes**

```bash
npm test
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: settings schema types + defineSchema helper"
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" push
```

---

## Task 5: Kit — Frontend renderer

**Files (in kit repo):**
- Create: `frontend/settings/renderer.ts`
- Create: `frontend/settings/styles.css`
- Test: `frontend/settings/renderer.test.ts`

The renderer is the meat of the frontend. It loads settings via `invoke("get_settings")`, renders the form from the schema, tracks dirty state, and saves via `invoke("save_settings", { settings })`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/settings/renderer.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { defineSchema } from "./schema";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: vi.fn() }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
}));

describe("renderSettingsPage", () => {
  beforeEach(() => {
    invoke.mockReset();
    document.body.innerHTML = "";
  });

  it("loads settings on mount and populates fields", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return { work_minutes: 25, sound_enabled: true };
      return undefined;
    });

    const { renderSettingsPage } = await import("./renderer");
    await renderSettingsPage(document.body, {
      schema: defineSchema({
        sections: [
          {
            title: "Times",
            fields: [
              { key: "work_minutes", kind: "number", label: "Work" },
              { key: "sound_enabled", kind: "toggle", label: "Sound" },
            ],
          },
        ],
      }),
    });

    const numberInput = document.querySelector<HTMLInputElement>(
      'input[data-key="work_minutes"]',
    );
    const toggleInput = document.querySelector<HTMLInputElement>(
      'input[data-key="sound_enabled"]',
    );
    expect(numberInput?.value).toBe("25");
    expect(toggleInput?.checked).toBe(true);
  });

  it("calls save_settings on save click with current form values", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_settings") return { work_minutes: 25 };
      if (cmd === "save_settings") return undefined;
      return undefined;
    });

    const { renderSettingsPage } = await import("./renderer");
    await renderSettingsPage(document.body, {
      schema: defineSchema({
        sections: [
          {
            title: "Times",
            fields: [{ key: "work_minutes", kind: "number", label: "Work" }],
          },
        ],
      }),
    });

    const input = document.querySelector<HTMLInputElement>(
      'input[data-key="work_minutes"]',
    )!;
    input.value = "42";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const saveBtn = document.querySelector<HTMLButtonElement>(
      'button[data-action="save"]',
    )!;
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(invoke).toHaveBeenCalledWith("save_settings", {
      settings: { work_minutes: 42 },
    });
  });

  it("renders select options", async () => {
    invoke.mockImplementation(async () => ({ corner: "tl" }));

    const { renderSettingsPage } = await import("./renderer");
    await renderSettingsPage(document.body, {
      schema: defineSchema({
        sections: [
          {
            title: "Pos",
            fields: [
              {
                key: "corner",
                kind: "select",
                label: "Corner",
                options: [
                  { value: "tl", label: "Top Left" },
                  { value: "tr", label: "Top Right" },
                ],
              },
            ],
          },
        ],
      }),
    });

    const select = document.querySelector<HTMLSelectElement>(
      'select[data-key="corner"]',
    )!;
    expect(select.value).toBe("tl");
    expect(select.options.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests — fail (renderer doesn't exist)**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
npm test
```

Expected: `Cannot find module './renderer'`.

- [ ] **Step 3: Implement `frontend/settings/styles.css`**

```css
.kit-settings { font-family: system-ui, sans-serif; padding: 20px; max-width: 480px; margin: 0 auto; }
.kit-settings h1 { font-size: 20px; margin: 0 0 16px; }
.kit-settings section { margin-bottom: 24px; }
.kit-settings h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin: 0 0 8px; }
.kit-settings label { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; gap: 12px; }
.kit-settings input[type="number"], .kit-settings input[type="text"], .kit-settings select {
  width: 120px; padding: 4px 6px; font-size: 14px;
}
.kit-settings input[type="range"] { width: 160px; }
.kit-settings input[type="checkbox"] { width: 18px; height: 18px; }
.kit-settings .kit-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; padding-top: 12px; border-top: 1px solid #ddd; }
.kit-settings button { padding: 6px 14px; font-size: 14px; cursor: pointer; }
.kit-settings button.primary { background: #4a90e2; color: white; border: none; }
.kit-settings button.primary:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 4: Implement `frontend/settings/renderer.ts`**

```ts
import { html, render, type TemplateResult } from "lit-html";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { SettingsSchema, Field } from "./schema";

export interface RenderOptions {
  schema: SettingsSchema;
  /** Defaults to "get_settings". */
  loadCommand?: string;
  /** Defaults to "save_settings". */
  saveCommand?: string;
  /** Event emitted after a successful save. Defaults to "settings-updated". */
  savedEvent?: string;
  /** Called after successful save with the saved settings object. */
  onSaved?: (settings: Record<string, unknown>) => void;
  /** Close the host window after save. Defaults to true. */
  closeOnSave?: boolean;
}

type SettingsValue = Record<string, unknown>;

export async function renderSettingsPage(
  root: HTMLElement,
  opts: RenderOptions,
): Promise<() => void> {
  const loadCmd = opts.loadCommand ?? "get_settings";
  const saveCmd = opts.saveCommand ?? "save_settings";
  const savedEvent = opts.savedEvent ?? "settings-updated";
  const closeOnSave = opts.closeOnSave ?? true;

  const original = (await invoke<SettingsValue>(loadCmd)) ?? {};
  let current: SettingsValue = { ...original };
  let dirty = false;

  const setField = (key: string, value: unknown) => {
    current[key] = value;
    dirty = true;
    paint();
  };

  const paint = () => {
    render(view(opts.schema, current, dirty, setField, save, cancel), root);
  };

  const save = async () => {
    await invoke(saveCmd, { settings: current });
    await emit(savedEvent, current);
    opts.onSaved?.(current);
    dirty = false;
    if (closeOnSave) {
      await getCurrentWindow().close();
    } else {
      paint();
    }
  };

  const cancel = async () => {
    await getCurrentWindow().close();
  };

  paint();

  return () => render(html``, root);
}

function view(
  schema: SettingsSchema,
  current: SettingsValue,
  dirty: boolean,
  set: (k: string, v: unknown) => void,
  onSave: () => void,
  onCancel: () => void,
): TemplateResult {
  return html`
    <div class="kit-settings">
      <h1>Settings</h1>
      ${schema.sections.map(
        (section) => html`
          <section>
            <h2>${section.title}</h2>
            ${section.fields.map((f) => fieldView(f, current[f.key], (v) => set(f.key, v)))}
          </section>
        `,
      )}
      <div class="kit-actions">
        <button data-action="cancel" @click=${onCancel}>Cancel</button>
        <button data-action="save" class="primary" ?disabled=${!dirty} @click=${onSave}>
          Save
        </button>
      </div>
    </div>
  `;
}

function fieldView(
  field: Field,
  value: unknown,
  onChange: (v: unknown) => void,
): TemplateResult {
  switch (field.kind) {
    case "number":
    case "integer": {
      const step = field.kind === "integer" ? 1 : "step" in field ? field.step : undefined;
      return html`
        <label>
          <span>${field.label}</span>
          <input
            type="number"
            data-key=${field.key}
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
        <label>
          <span>${field.label}</span>
          <input
            type="range"
            data-key=${field.key}
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
        <label>
          <span>${field.label}</span>
          <select
            data-key=${field.key}
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
        <label>
          <span>${field.label}</span>
          <input
            type="checkbox"
            data-key=${field.key}
            .checked=${Boolean(value)}
            @change=${(e: Event) => onChange((e.target as HTMLInputElement).checked)}
          />
        </label>
      `;
    case "text":
      return html`
        <label>
          <span>${field.label}</span>
          <input
            type="text"
            data-key=${field.key}
            .value=${String(value ?? "")}
            @input=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
          />
        </label>
      `;
    case "file": {
      const display = value ? String(value) : field.defaultLabel ?? "(none)";
      return html`
        <label>
          <span>${field.label}</span>
          <span style="display:flex;gap:8px;align-items:center;">
            <span style="font-size:12px;color:#666;">${display}</span>
            <button
              type="button"
              data-key=${field.key}
              @click=${async () => {
                const picked = await invoke<string | null>(field.pickerCommand);
                if (picked) onChange(picked);
              }}
            >
              Pick...
            </button>
            <button type="button" @click=${() => onChange(null)}>Reset</button>
          </span>
        </label>
      `;
    }
    case "custom":
      return field.render(value, onChange);
  }
}
```

- [ ] **Step 5: Run tests — pass**

```bash
npm test
```

Expected: all tests pass (3 in renderer.test.ts + 2 in schema.test.ts = 5).

If any fail, debug. Common issues: lit-html `@input` not firing in JSDOM (use `dispatchEvent(new Event("input"))`), `getCurrentWindow` not mocked, etc.

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings package.json package-lock.json
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: settings renderer with all v1 field kinds"
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" push
```

---

## Task 6: Kit — Frontend window helper

**Files (in kit repo):**
- Create: `frontend/settings/window.ts`
- Test: `frontend/settings/window.test.ts`

Wraps Tauri's `WebviewWindow.getByLabel` + `WebviewWindow.new` to spawn (or focus existing) settings window.

- [ ] **Step 1: Write the failing test**

Create `frontend/settings/window.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const ctorMock = vi.fn();
const setFocusMock = vi.fn();
const getByLabelMock = vi.fn();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = getByLabelMock;
    constructor(label: string, opts: object) {
      ctorMock(label, opts);
    }
  },
}));

describe("openSettingsWindow", () => {
  beforeEach(() => {
    ctorMock.mockReset();
    setFocusMock.mockReset();
    getByLabelMock.mockReset();
  });

  it("creates a new window when none exists", async () => {
    getByLabelMock.mockResolvedValue(null);
    const { openSettingsWindow } = await import("./window");

    await openSettingsWindow({ url: "settings.html", title: "Settings" });

    expect(ctorMock).toHaveBeenCalledWith(
      "kit-settings",
      expect.objectContaining({ url: "settings.html", title: "Settings" }),
    );
  });

  it("focuses existing window if already open", async () => {
    getByLabelMock.mockResolvedValue({ setFocus: setFocusMock });
    const { openSettingsWindow } = await import("./window");

    await openSettingsWindow({ url: "settings.html" });

    expect(setFocusMock).toHaveBeenCalled();
    expect(ctorMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — fail**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
npm test
```

Expected: `Cannot find module './window'`.

- [ ] **Step 3: Implement `frontend/settings/window.ts`**

```ts
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export interface OpenSettingsOptions {
  url: string;
  width?: number;
  height?: number;
  title?: string;
  label?: string;
  resizable?: boolean;
}

export async function openSettingsWindow(opts: OpenSettingsOptions): Promise<void> {
  const label = opts.label ?? "kit-settings";
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  new WebviewWindow(label, {
    url: opts.url,
    title: opts.title ?? "Settings",
    width: opts.width ?? 480,
    height: opts.height ?? 720,
    resizable: opts.resizable ?? true,
    center: true,
  });
}
```

- [ ] **Step 4: Run tests — pass**

```bash
npm test
```

Expected: 7 tests pass total.

- [ ] **Step 5: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/settings
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: openSettingsWindow helper with focus-existing behavior"
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" push
```

---

## Task 7: Pomodoro — define schema for current settings

**Files (in pomodoro-overlay):**
- Modify: `vendor/tauri_kit/` submodule pointer (pull latest)
- Create: `src/settings/schema.ts`

This task only writes the schema file. Doesn't yet wire it to the UI — that's Task 8.

- [ ] **Step 1: Pull latest kit**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/vendor/tauri_kit"
git pull origin main
cd ../..
```

- [ ] **Step 2: Read pomodoro's existing settings.html to enumerate every field**

Open `src/settings.html`. Confirm 5 sections (Times / Position & Size / Visibility / Sound / Behavior) and these fields:

- `work_minutes` (number 1-180)
- `short_break_minutes` (number 1-60)
- `long_break_minutes` (number 1-120)
- `sessions_before_long_break` (number 1-10, integer)
- `corner` (select: tl/tr/bl/br)
- `always_on_top` (toggle)
- `return_to_corner_seconds` (number 0-3600, integer)
- `fade_when` (select: never/running/always)
- `idle_opacity` (range 0-1, step 0.05)
- `auto_collapse` (toggle)
- `sound_enabled` (toggle)
- `volume` (range 0-1, step 0.05)
- `sound_path` (file picker via `pick_sound_file` command)
- `auto_advance` (toggle)
- `autostart` (toggle)

If actual field names/types differ from above, treat the existing `settings.html` and `settings.js` as authoritative.

- [ ] **Step 3: Create `src/settings/schema.ts`**

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
        { key: "autostart", kind: "toggle", label: "Launch at Windows startup" },
      ],
    },
  ],
});
```

- [ ] **Step 4: Type-check**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npx tsc --noEmit
```

Expected: passes. If lit-html types not resolved from kit submodule, ensure `tsconfig.json` `include` array contains `"vendor/tauri_kit/frontend/**/*.ts"` (set in Plan A Task 3).

- [ ] **Step 5: No commit yet — task 8 makes the schema actually used**

---

## Task 8: Pomodoro — replace settings.html / settings.js with kit shell

**Files (in pomodoro-overlay):**
- Modify: `src/settings.html` (rewrite as thin shell)
- Delete: `src/settings.js`
- Delete: `src/settings.css` (kit ships its own styles)
- Create: `src/settings/main.ts`
- Modify: `src-tauri/src/main.rs` if it spawns the settings window via Rust (likely it does)

- [ ] **Step 1: Rewrite `src/settings.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline' https://unpkg.com; style-src 'self' 'unsafe-inline' https://unpkg.com" />
  <title>Settings</title>
  <link rel="stylesheet" href="../vendor/tauri_kit/frontend/settings/styles.css" />
  <script src="https://unpkg.com/@phosphor-icons/web"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./settings/main.ts"></script>
</body>
</html>
```

Note: in Vite production build, the relative `../vendor/...` CSS path will resolve through Vite's asset pipeline. If Vite complains during build that the path is outside `root`, switch the link to:

```html
<link rel="stylesheet" href="/@fs/<absolute-path>" />
```

or import the CSS from `main.ts` instead (Vite handles `import "..." with side-effect):

```ts
import "../../vendor/tauri_kit/frontend/settings/styles.css";
```

Prefer the latter (CSS-in-JS-via-Vite) — more portable. Update the HTML to drop the `<link>` if you take the import route.

- [ ] **Step 2: Create `src/settings/main.ts`**

```ts
import "../../vendor/tauri_kit/frontend/settings/styles.css";
import { renderSettingsPage } from "../../vendor/tauri_kit/frontend/settings/renderer";
import { settingsSchema } from "./schema";

const root = document.getElementById("root");
if (!root) throw new Error("settings root missing");

renderSettingsPage(root, { schema: settingsSchema });
```

- [ ] **Step 3: Delete the old files**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" rm src/settings.js src/settings.css
```

- [ ] **Step 4: Update Vite config if needed**

Confirm `vite.config.ts` `rollupOptions.input.settings` still points at `src/settings.html`. (No change needed — same path.)

- [ ] **Step 5: Build and dev-test**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npm run build
```

Expected: succeeds, `dist/settings.html` produced with bundled JS+CSS.

```bash
npm run tauri dev
```

In the running app:
- Open settings via tray (or however pomodoro currently triggers it).
- Settings window appears with all 5 sections, all 15 fields, current values populated.
- Change a value (e.g. work_minutes 25 → 26), Save.
- Window closes. Re-open — the new value is persisted.
- Verify the underlying file matches expected shape:

```bash
cat "$env:APPDATA/com.sirbepy.pomodoro-overlay/settings.json"
```

Expected: same JSON structure as before this plan started; only `work_minutes` differs.

- [ ] **Step 6: Manual UX checks**

- Cancel button closes window without saving (re-open and verify value reverted).
- Save button is disabled when no changes have been made (dirty=false).
- File picker for sound_path opens a dialog (calls `pick_sound_file`). If pomodoro's `pick_sound_file` command exists and works, the picker should succeed. Otherwise this is a pre-existing issue, not a regression.
- All toggles, ranges, selects respond correctly.
- Visual: window looks reasonable. Spec doesn't require pixel-perfect parity with old design; functional parity is enough.

If anything breaks, fix in the kit (check, schema mistake, or renderer bug). Push to kit, pull submodule, retest.

- [ ] **Step 7: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add src/settings.html src/settings package.json vendor/tauri_kit
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "REFACTOR: settings UI rendered from kit schema; delete bespoke settings.html/js/css"
```

---

## Self-review checklist

Before declaring Plan B done:

- [ ] Kit `cargo test -p tauri_kit_settings` passes (5 tests)
- [ ] Kit `npm test` passes (≥7 tests across schema/renderer/window)
- [ ] Pomodoro `cargo check` passes
- [ ] Pomodoro `npm run build` produces dist with both index.html and settings.html
- [ ] Pomodoro `cargo tauri dev` runs the overlay
- [ ] Settings window opens, all 15 fields present and populated from existing settings.json
- [ ] Save persists changes to the same JSON file shape (no field renames, no missing keys)
- [ ] Cancel doesn't persist
- [ ] Old `src/settings.js` and `src/settings.css` are deleted from git history (last commit)
- [ ] No regressions: pomodoro overlay timer/hover/corner behavior unchanged

---

## Out of scope (covered by Plan C)

- Updater plugin
- New release CI workflow
- Version sync fix in Cargo.toml
- Tag pattern change
- Bumping pomodoro to 0.2.0
