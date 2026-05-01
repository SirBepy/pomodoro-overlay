# Plan A: Bootstrap sirbepy_tauri_kit + Vite Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `sirbepy_tauri_kit` repo skeleton, wire it into pomodoro-overlay as a submodule, and add a Vite + TypeScript build pipeline to pomodoro so it can consume the kit's TS source.

**Architecture:** Kit lives in its own GitHub repo. Frontend pieces are TS source consumed via Vite. Rust pieces are cargo crates consumed via path-deps. Pomodoro adds a submodule at `vendor/tauri_kit/`. After this plan, kit is empty stubs and pomodoro builds via Vite without yet depending on kit code; ready for Plan B to start porting.

**Tech Stack:** Tauri 2, Vite 5, TypeScript 5, lit-html 3, Cargo, Git submodules.

**Pre-req:** This plan touches **two repos**. The kit repo doesn't exist yet (Task 1 creates it). All other tasks operate inside `pomodoro-overlay`.

**Source spec:** `docs/superpowers/specs/2026-05-01-shared-tauri-kit-design.md`

---

## Task 1: Create sirbepy_tauri_kit repo with skeleton

**Files (in new kit repo, not pomodoro):**
- Create: `sirbepy_tauri_kit/.gitignore`
- Create: `sirbepy_tauri_kit/README.md`
- Create: `sirbepy_tauri_kit/CHANGELOG.md`
- Create: `sirbepy_tauri_kit/package.json`
- Create: `sirbepy_tauri_kit/tsconfig.json`
- Create: `sirbepy_tauri_kit/vitest.config.ts`
- Create: `sirbepy_tauri_kit/frontend/settings/.gitkeep`
- Create: `sirbepy_tauri_kit/frontend/updater/.gitkeep`
- Create: `sirbepy_tauri_kit/tauri/settings/Cargo.toml`
- Create: `sirbepy_tauri_kit/tauri/settings/src/lib.rs`
- Create: `sirbepy_tauri_kit/tauri/updater/Cargo.toml`
- Create: `sirbepy_tauri_kit/tauri/updater/src/lib.rs`
- Create: `sirbepy_tauri_kit/Cargo.toml` (workspace root)

- [ ] **Step 1: Create the GitHub repo**

User must run this themselves (auth required):

```bash
gh repo create SirBepy/sirbepy_tauri_kit --public --description "Shared Tauri building blocks: settings UI + updater + release CI" --clone
```

This clones to a parent dir of choice (suggested: `C:\Users\tecno\Desktop\Projects\sirbepy_tauri_kit`).

If `gh` is not available, create at https://github.com/new and clone manually.

- [ ] **Step 2: Add `.gitignore`**

```gitignore
# Rust
target/
**/target/
Cargo.lock

# Node
node_modules/
*.log

# IDE
.vscode/
.idea/
.DS_Store

# Build artifacts
dist/
```

- [ ] **Step 3: Add `README.md`**

```markdown
# sirbepy_tauri_kit

Shared building blocks for SirBepy's Tauri desktop apps.

## What's inside

- `frontend/settings/` — schema-driven settings page (lit-html + TS)
- `frontend/updater/` — auto-update check helpers
- `tauri/settings/` — generic JSON-backed settings store (Rust crate)
- `tauri/updater/` — updater plugin registration helper (Rust crate)

## Consuming this kit

Add as a git submodule in your Tauri app:

\`\`\`bash
git submodule add https://github.com/SirBepy/sirbepy_tauri_kit.git vendor/tauri_kit
\`\`\`

Then reference Rust crates via cargo path-deps and import TS via Vite.

See the consumer apps (`pomodoro-overlay`, `claude_usage_in_taskbar`) for examples.
```

- [ ] **Step 4: Add `CHANGELOG.md`**

```markdown
# Changelog

## Unreleased

- Initial repo skeleton.
```

- [ ] **Step 5: Add root `package.json`**

```json
{
  "name": "sirbepy-tauri-kit",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "20.19.39",
    "jsdom": "^25.0.0",
    "typescript": "5.9.3",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "lit-html": "3.3.2",
    "@tauri-apps/api": "^2.0.0"
  }
}
```

- [ ] **Step 6: Add `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "declaration": true,
    "noEmit": true
  },
  "include": ["frontend/**/*.ts"]
}
```

- [ ] **Step 7: Add `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["frontend/**/*.test.ts"],
  },
});
```

- [ ] **Step 8: Add cargo workspace root `Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = [
  "tauri/settings",
  "tauri/updater",
]

[workspace.package]
edition = "2021"
rust-version = "1.80"
license = "MIT"
authors = ["SirBepy"]
```

- [ ] **Step 9: Add `tauri/settings/Cargo.toml`**

```toml
[package]
name = "tauri_kit_settings"
version = "0.0.1"
edition.workspace = true
license.workspace = true

[dependencies]
tauri = { version = "2.0" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 10: Add `tauri/settings/src/lib.rs` (stub)**

```rust
//! Generic JSON-backed settings store + Tauri command helpers.
//!
//! Filled in by Plan B.
```

- [ ] **Step 11: Add `tauri/updater/Cargo.toml`**

```toml
[package]
name = "tauri_kit_updater"
version = "0.0.1"
edition.workspace = true
license.workspace = true

[dependencies]
tauri = { version = "2.0" }
tauri-plugin-updater = "2.0"
```

- [ ] **Step 12: Add `tauri/updater/src/lib.rs` (stub)**

```rust
//! Updater plugin registration helper.
//!
//! Filled in by Plan C.
```

- [ ] **Step 13: Add `frontend/settings/.gitkeep` and `frontend/updater/.gitkeep`**

Empty files. Just so the directories exist in git.

- [ ] **Step 14: Verify the kit builds**

In the kit repo:

```bash
cargo check --workspace
npm install
npx tsc --noEmit
```

Expected: all three pass with no errors.

- [ ] **Step 15: Commit and push**

```bash
git add .
git commit -m "CHORE: initial skeleton (Cargo workspace, Vite/TS, stubs)"
git push -u origin main
```

---

## Task 2: Add kit as submodule in pomodoro-overlay

**Files (in pomodoro-overlay):**
- Create: `vendor/tauri_kit/` (submodule pointer)
- Modify: `.gitmodules` (created by submodule add)

- [ ] **Step 1: Add submodule**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" submodule add https://github.com/SirBepy/sirbepy_tauri_kit.git vendor/tauri_kit
```

Expected output: `Cloning into '.../pomodoro-overlay/vendor/tauri_kit'... done.`

- [ ] **Step 2: Verify submodule pointer**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" submodule status
```

Expected: one line with the kit's HEAD SHA, ` vendor/tauri_kit (heads/main)`.

- [ ] **Step 3: Verify the kit files are present**

```bash
ls "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/vendor/tauri_kit"
```

Expected: includes `README.md`, `Cargo.toml`, `frontend/`, `tauri/`, `package.json`, `tsconfig.json`.

- [ ] **Step 4: Commit submodule addition**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add .gitmodules vendor/tauri_kit
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "CHORE: add sirbepy_tauri_kit submodule at vendor/tauri_kit"
```

---

## Task 3: Add Vite + TypeScript pipeline to pomodoro

**Files (in pomodoro-overlay):**
- Modify: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Modify: `src-tauri/tauri.conf.json` (frontendDist + before commands)
- Modify: `.gitignore` (already ignores `dist/`, no change needed)

This task adds the build pipeline but does NOT yet move any code to TS. After this task, `npm run dev` and `tauri dev` still work and pomodoro behaves identically.

- [ ] **Step 1: Update `package.json`**

```json
{
  "name": "pomodoro-overlay",
  "version": "0.1.3",
  "private": true,
  "type": "module",
  "scripts": {
    "tauri": "tauri",
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/node": "20.19.39",
    "typescript": "5.9.3",
    "vite": "5.4.21"
  },
  "dependencies": {
    "lit-html": "3.3.2",
    "@tauri-apps/api": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts`**

The pomodoro overlay has two HTML entrypoints (main `index.html` + `settings.html`). Vite's MPA mode handles this. Note: dev port 1420 matches Tauri's default.

```ts
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src",
  publicDir: false,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        settings: resolve(__dirname, "src/settings.html"),
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": true,
    "checkJs": false,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.js", "vendor/tauri_kit/frontend/**/*.ts"]
}
```

`allowJs: true` lets Vite consume the existing `.js` files unchanged. `checkJs: false` skips type-checking them (they're vanilla JS, not annotated).

- [ ] **Step 4: Update `src-tauri/tauri.conf.json` build block**

Change:

```json
  "build": {
    "frontendDist": "../src"
  },
```

To:

```json
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
```

- [ ] **Step 5: Install dependencies**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npm install
```

Expected: `node_modules/` populates with vite, typescript, lit-html, @tauri-apps/api, @tauri-apps/cli.

- [ ] **Step 6: Verify Vite dev server starts**

```bash
npm run dev
```

Expected output:
```
  VITE v5.4.21  ready in <ms>
  ➜  Local:   http://localhost:1420/
```

Visit `http://localhost:1420/` in browser. Pomodoro overlay UI should render. Visit `http://localhost:1420/settings.html` — settings UI should render. Stop the server (Ctrl+C).

- [ ] **Step 7: Verify Vite build produces output**

```bash
npm run build
```

Expected: `dist/` directory created with `index.html`, `settings.html`, hashed JS/CSS bundles.

```bash
ls dist
```

Expected: includes `index.html`, `settings.html`, `assets/` directory.

- [ ] **Step 8: Verify Tauri dev still works**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/src-tauri"
cargo tauri dev
```

Expected: pomodoro overlay window appears, behaves as before. Right-click tray → Settings opens settings window. Stop with Ctrl+C.

- [ ] **Step 9: Verify Tauri build still works**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/src-tauri"
cargo tauri build
```

Expected: build completes, NSIS installer + MSI produced under `target/release/bundle/`.

- [ ] **Step 10: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add package.json package-lock.json vite.config.ts tsconfig.json src-tauri/tauri.conf.json
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "CHORE: add Vite + TypeScript build pipeline"
```

---

## Task 4: Smoke-test cross-repo developer workflow

**Files:** none modified.

This is verification, not implementation. Confirms the submodule + Vite + Tauri loop is healthy before Plan B starts moving code into the kit.

- [ ] **Step 1: Clean clone test**

In a temp directory, simulate a fresh checkout:

```bash
cd /tmp
git clone --recurse-submodules https://github.com/SirBepy/pomodoro-overlay.git pomodoro-clone-test
cd pomodoro-clone-test
ls vendor/tauri_kit
```

Expected: kit files present (proves `--recurse-submodules` pulls them).

- [ ] **Step 2: Build from clean clone**

```bash
npm install
npm run build
```

Expected: `dist/` produced, no errors.

```bash
cd src-tauri
cargo tauri build
```

Expected: installer produced.

- [ ] **Step 3: Clean up**

```bash
cd /tmp
rm -rf pomodoro-clone-test
```

- [ ] **Step 4: No commit needed (smoke test only)**

If anything in this task failed, fix the underlying cause and re-test before declaring Plan A complete.

---

## Self-review checklist

Before declaring Plan A done:

- [ ] Kit repo exists on GitHub at `SirBepy/sirbepy_tauri_kit`, public
- [ ] Kit repo `cargo check --workspace` passes
- [ ] Kit repo `npx tsc --noEmit` passes
- [ ] Pomodoro `vendor/tauri_kit/` submodule resolves
- [ ] Pomodoro `npm run dev` starts Vite at 1420
- [ ] Pomodoro `npm run build` produces `dist/`
- [ ] Pomodoro `cargo tauri dev` runs the overlay (regression check)
- [ ] Pomodoro `cargo tauri build` produces installers (regression check)
- [ ] Settings window still opens and works (existing JS, untouched)
- [ ] Clean-clone test in Task 4 passes

If any item fails, fix and re-verify before moving to Plan B.

---

## Out of scope (covered by later plans)

- Porting any settings code into the kit — Plan B
- Building the schema/renderer — Plan B
- Updater plugin / release CI — Plan C
- Bumping pomodoro to 0.2.0 — Plan C
