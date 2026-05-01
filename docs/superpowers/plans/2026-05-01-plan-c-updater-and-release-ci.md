# Plan C: Updater + Release CI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the kit's updater plugin wiring, replace pomodoro's release CI with the claude_usage-style workflow that generates signed `latest.json`, switch source-of-truth to `package.json`, and ship `tauri-v0.2.0` as the first kit-consuming release with end-to-end auto-update verified.

**Architecture:** Kit owns thin wrappers around `tauri-plugin-updater` (Rust register helper + frontend check helper). Pomodoro registers the plugin, fetches release manifest from GitHub on startup, prompts user, installs. CI builds Windows installer, generates `latest.json` with signature, attaches both to a GitHub release.

**Tech Stack:** tauri-plugin-updater 2.0, GitHub Actions, NSIS, Tauri's minisign signing.

**Pre-req:** Plans A + B complete. Pomodoro builds via Vite, settings goes through the kit.

**Source spec:** `docs/superpowers/specs/2026-05-01-shared-tauri-kit-design.md`

**User-only manual steps:** Task 3 (key generation) and Task 4 (GitHub Secrets configuration) require user actions Claude cannot perform. Each is clearly labeled.

---

## Task 1: Kit — Rust updater registration helper

**Files (in kit repo):**
- Modify: `tauri/updater/src/lib.rs`

`tauri-plugin-updater` already does all the work. The kit's wrapper exists so apps don't have to remember the exact builder pattern and so kit can later inject defaults (e.g. periodic re-check interval) in one place.

- [ ] **Step 1: Replace `tauri/updater/src/lib.rs`**

```rust
//! Tauri updater plugin registration helper.
//!
//! Apps call `tauri_kit_updater::plugin()` and add it to their Tauri builder.
//! Endpoints + pubkey are configured per-app in `tauri.conf.json`.

use tauri::{plugin::TauriPlugin, Wry};

/// Returns a configured `tauri-plugin-updater` plugin instance.
pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_updater::Builder::new().build()
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
cargo check --workspace
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add tauri/updater/src/lib.rs
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: updater plugin registration helper"
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" push
```

---

## Task 2: Kit — Frontend update-check helper

**Files (in kit repo):**
- Create: `frontend/updater/check.ts`
- Test: `frontend/updater/check.test.ts`

Wraps `@tauri-apps/plugin-updater`'s `check()` + `downloadAndInstall()` with a default user prompt. App calls once on startup; helper handles the rest.

- [ ] **Step 1: Add the plugin-updater JS dep**

In kit's `package.json`, add to `dependencies`:

```json
    "@tauri-apps/plugin-updater": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0"
```

Then:

```bash
cd "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit"
npm install
```

- [ ] **Step 2: Write the failing test**

Create `frontend/updater/check.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const checkMock = vi.fn();
const askMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: () => checkMock(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: (...args: unknown[]) => askMock(...args),
}));

describe("checkAndPromptUpdate", () => {
  beforeEach(() => {
    checkMock.mockReset();
    askMock.mockReset();
  });

  it("does nothing when no update available", async () => {
    checkMock.mockResolvedValue(null);
    const { checkAndPromptUpdate } = await import("./check");
    await checkAndPromptUpdate();
    expect(askMock).not.toHaveBeenCalled();
  });

  it("prompts user when update available, installs on confirm", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    checkMock.mockResolvedValue({ version: "0.3.0", downloadAndInstall });
    askMock.mockResolvedValue(true);

    const { checkAndPromptUpdate } = await import("./check");
    await checkAndPromptUpdate();

    expect(askMock).toHaveBeenCalled();
    expect(downloadAndInstall).toHaveBeenCalled();
  });

  it("does not install when user declines prompt", async () => {
    const downloadAndInstall = vi.fn();
    checkMock.mockResolvedValue({ version: "0.3.0", downloadAndInstall });
    askMock.mockResolvedValue(false);

    const { checkAndPromptUpdate } = await import("./check");
    await checkAndPromptUpdate();

    expect(downloadAndInstall).not.toHaveBeenCalled();
  });

  it("swallows errors from check", async () => {
    checkMock.mockRejectedValue(new Error("network down"));
    const { checkAndPromptUpdate } = await import("./check");
    await expect(checkAndPromptUpdate()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests — fail**

```bash
npm test
```

Expected: `Cannot find module './check'`.

- [ ] **Step 4: Implement `frontend/updater/check.ts`**

```ts
import { check } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";

export interface CheckOptions {
  /** Defaults to "Update available". */
  promptTitle?: string;
  /** Override the body. Receives the new version. */
  promptBody?: (version: string) => string;
}

export async function checkAndPromptUpdate(opts: CheckOptions = {}): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    const title = opts.promptTitle ?? "Update available";
    const body = opts.promptBody
      ? opts.promptBody(update.version)
      : `Version ${update.version} is available. Install now?`;

    const confirmed = await ask(body, { title, kind: "info" });
    if (!confirmed) return;

    await update.downloadAndInstall();
  } catch (err) {
    console.warn("[tauri_kit_updater] update check failed:", err);
  }
}
```

- [ ] **Step 5: Run tests — pass**

```bash
npm test
```

Expected: all kit tests pass (≥11 now: 2 schema + 3 renderer + 2 window + 4 update-check).

- [ ] **Step 6: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" add frontend/updater package.json package-lock.json
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" commit -m "FEAT: checkAndPromptUpdate frontend helper"
git -C "C:/Users/tecno/Desktop/Projects/sirbepy_tauri_kit" push
```

---

## Task 3: USER MANUAL — generate pomodoro updater keypair

**This task is the user's responsibility.** Claude cannot generate signing keys for the user's apps.

- [ ] **Step 1: Install Tauri CLI signer if not present**

```bash
cargo install tauri-cli --version "^2.0"
```

(Likely already installed.)

- [ ] **Step 2: Generate keypair**

```bash
mkdir -p "$HOME/.tauri"
cargo tauri signer generate -w "$HOME/.tauri/pomodoro_updater.key"
```

When prompted, enter a strong password. Save it in your password manager — you will need it for CI secrets.

This creates two files:
- `~/.tauri/pomodoro_updater.key` — private key (NEVER commit, NEVER share)
- `~/.tauri/pomodoro_updater.key.pub` — public key

- [ ] **Step 3: Note the pubkey value**

```bash
cat "$HOME/.tauri/pomodoro_updater.key.pub"
```

Copy the entire content (single line, starts with `dW50cnVzdGVk...` after `untrusted comment` line). This goes into `tauri.conf.json` in Task 5.

- [ ] **Step 4: No commit — keys never go in git**

---

## Task 4: USER MANUAL — add GitHub repo secrets

**User's responsibility.** Set the secrets `tauri-release.yml` will read.

- [ ] **Step 1: Open repo settings**

Navigate to: https://github.com/SirBepy/pomodoro-overlay/settings/secrets/actions

- [ ] **Step 2: Add `TAURI_SIGNING_PRIVATE_KEY`**

Click "New repository secret".
- Name: `TAURI_SIGNING_PRIVATE_KEY`
- Value: paste the entire contents of `~/.tauri/pomodoro_updater.key`

- [ ] **Step 3: Add `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**

Click "New repository secret".
- Name: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Value: the password you set when generating the keypair

- [ ] **Step 4: Confirm both are listed**

Repository → Settings → Secrets and variables → Actions should show both names (values masked).

---

## Task 5: Pomodoro — wire updater plugin

**Files (in pomodoro-overlay):**
- Modify: `vendor/tauri_kit/` submodule pointer (pull latest)
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src/app.js` (or `src/app.ts` if migrated) — call `checkAndPromptUpdate()` on load

- [ ] **Step 1: Pull latest kit**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/vendor/tauri_kit"
git pull origin main
cd ../..
```

- [ ] **Step 2: Add `tauri_kit_updater` path-dep**

In `src-tauri/Cargo.toml`, under `[dependencies]`:

```toml
tauri_kit_updater = { path = "../vendor/tauri_kit/tauri/updater" }
```

- [ ] **Step 3: Register plugin in `src-tauri/src/main.rs`**

In the `tauri::Builder::default()` chain, add:

```rust
.plugin(tauri_kit_updater::plugin())
```

Place it next to the other `.plugin()` calls (autostart, single-instance, dialog, notification).

- [ ] **Step 4: Update `src-tauri/tauri.conf.json` — bundle + plugins blocks**

Find:

```json
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis"],
    "icon": [ ... ]
  },
  "plugins": {}
```

Replace with:

```json
  "bundle": {
    "active": true,
    "createUpdaterArtifacts": true,
    "targets": ["msi", "nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.ico"
    ],
    "publisher": "SirBepy"
  },
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/SirBepy/pomodoro-overlay/releases/latest/download/latest.json"
      ],
      "pubkey": "<PASTE PUBKEY FROM TASK 3 STEP 3>",
      "dialog": false
    }
  }
```

Replace `<PASTE PUBKEY FROM TASK 3 STEP 3>` with the actual single-line pubkey content.

`dialog: false` because we're using kit's frontend `checkAndPromptUpdate()` for the prompt; `dialog: true` would be Tauri's built-in prompt and is mutually exclusive.

- [ ] **Step 5: Add updater capability**

In `src-tauri/capabilities/default.json`, add `"updater:default"` to the permissions list. (Read the file first to find the existing list shape.)

- [ ] **Step 6: Add `tauri-plugin-updater` JS dep to pomodoro**

In pomodoro `package.json`, under `dependencies`, add:

```json
    "@tauri-apps/plugin-updater": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0"
```

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npm install
```

- [ ] **Step 7: Call `checkAndPromptUpdate()` on app load**

At the top of `src/app.js` (or wherever pomodoro's main entry runs), add:

```js
import { checkAndPromptUpdate } from "../vendor/tauri_kit/frontend/updater/check";

// Fire-and-forget: never blocks app startup.
checkAndPromptUpdate();
```

If `app.js` isn't an ES module yet (it might be loaded via plain `<script>`), convert by changing the `<script>` tag in `src/index.html` to `<script type="module" src="./app.js"></script>`. Vite will resolve the import.

- [ ] **Step 8: Verify cargo build**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/src-tauri"
cargo check
```

Expected: passes.

- [ ] **Step 9: Verify dev still runs**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npm run tauri dev
```

Expected: pomodoro overlay launches normally. Updater check runs in background — in dev mode, it'll likely fail to fetch (no published `latest.json` yet). The `console.warn` from kit should appear in dev console, app continues unaffected. This is the desired error-tolerance behavior.

- [ ] **Step 10: Commit pomodoro side**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src src-tauri/tauri.conf.json src-tauri/capabilities src package.json package-lock.json vendor/tauri_kit
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "FEAT: wire tauri_kit_updater plugin + check-on-startup"
```

---

## Task 6: Pomodoro — replace release.yml with claude_usage-style workflow

**Files (in pomodoro-overlay):**
- Modify: `.github/workflows/release.yml`

This task replaces the current single-stage workflow with a 4-stage workflow (check → tag → build → publish) that produces signed `latest.json` for the updater. Source-of-truth becomes `package.json`. Tag pattern becomes `tauri-v$VERSION`.

- [ ] **Step 1: Replace `.github/workflows/release.yml`**

```yaml
name: Tauri Release

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write

jobs:
  check:
    runs-on: ubuntu-latest
    outputs:
      should_release: ${{ steps.check.outputs.should_release }}
      tag: ${{ steps.check.outputs.tag }}
      version: ${{ steps.check.outputs.version }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          submodules: recursive

      - name: Resolve version and tag
        id: check
        shell: bash
        run: |
          VERSION=$(jq -r .version package.json)
          TAG="tauri-v$VERSION"
          echo "tag=$TAG" >> "$GITHUB_OUTPUT"
          echo "version=$VERSION" >> "$GITHUB_OUTPUT"
          if git rev-parse "refs/tags/$TAG" >/dev/null 2>&1; then
            echo "Tag $TAG already exists. Skipping release."
            echo "should_release=false" >> "$GITHUB_OUTPUT"
          else
            echo "Tag $TAG not found. Will release."
            echo "should_release=true" >> "$GITHUB_OUTPUT"
          fi

  tag:
    needs: check
    if: needs.check.outputs.should_release == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - name: Create and push tag
        shell: bash
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git tag "${{ needs.check.outputs.tag }}"
          git push origin "${{ needs.check.outputs.tag }}"

  build:
    needs: [check, tag]
    if: needs.check.outputs.should_release == 'true'
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install frontend dependencies
        run: npm ci

      - name: Sync version into tauri.conf.json and Cargo.toml
        shell: bash
        run: |
          VERSION="${{ needs.check.outputs.version }}"
          jq --arg v "$VERSION" '.version = $v' src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp
          mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
          sed -i.bak -E "s/^version = \".*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml
          rm src-tauri/Cargo.toml.bak

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: x86_64-pc-windows-msvc

      - name: Cache cargo
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
          key: x86_64-pc-windows-msvc
          cache-on-failure: true

      - name: Install Tauri CLI
        uses: taiki-e/install-action@v2
        with:
          tool: tauri-cli

      - name: Build
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        working-directory: src-tauri
        run: cargo tauri build --target x86_64-pc-windows-msvc

      - name: Stage Windows artifacts
        shell: bash
        working-directory: src-tauri/target/x86_64-pc-windows-msvc/release/bundle
        run: |
          TAG="${{ needs.check.outputs.tag }}"
          VERSION="${{ needs.check.outputs.version }}"
          mkdir -p "$GITHUB_WORKSPACE/release-staging"

          # NSIS installer doubles as updater payload.
          EXE=$(ls nsis/*_x64-setup.exe | head -n 1)
          ASSET="Pomodoro-Overlay_${VERSION}_windows_x64.exe"
          cp "$EXE" "$GITHUB_WORKSPACE/release-staging/$ASSET"
          cp "${EXE}.sig" "$GITHUB_WORKSPACE/release-staging/${ASSET}.sig"

          SIG=$(cat "${EXE}.sig")
          URL="https://github.com/SirBepy/pomodoro-overlay/releases/download/${TAG}/${ASSET}"
          jq -n --arg sig "$SIG" --arg url "$URL" \
            '{signature:$sig, url:$url}' \
            > "$GITHUB_WORKSPACE/release-staging/windows-x86_64.json"

          # MSI for users who prefer it (not part of updater payload).
          if ls msi/*.msi 2>/dev/null; then
            MSI=$(ls msi/*.msi | head -n 1)
            cp "$MSI" "$GITHUB_WORKSPACE/release-staging/Pomodoro-Overlay_${VERSION}_windows_x64.msi"
          fi

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: release-windows-x86_64
          path: release-staging/

  publish:
    needs: [check, tag, build]
    if: needs.check.outputs.should_release == 'true'
    runs-on: ubuntu-latest
    steps:
      - name: Download artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts/
          pattern: release-*
          merge-multiple: true

      - name: Generate latest.json
        shell: bash
        working-directory: artifacts
        run: |
          VERSION="${{ needs.check.outputs.version }}"
          DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
          PLATFORMS="{}"
          for f in *.json; do
            KEY="${f%.json}"
            PLATFORMS=$(jq --arg k "$KEY" --slurpfile p "$f" \
              '. + {($k): $p[0]}' <<< "$PLATFORMS")
          done
          jq -n \
            --arg version "$VERSION" \
            --arg notes "Release $VERSION" \
            --arg pub_date "$DATE" \
            --argjson platforms "$PLATFORMS" \
            '{version:$version, notes:$notes, pub_date:$pub_date, platforms:$platforms}' \
            > latest.json
          cat latest.json

      - name: Upload to release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            artifacts/*.exe
            artifacts/*.exe.sig
            artifacts/*.msi
            artifacts/latest.json
          tag_name: ${{ needs.check.outputs.tag }}
          name: ${{ needs.check.outputs.tag }}
          draft: false
          make_latest: "true"
```

- [ ] **Step 2: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add .github/workflows/release.yml
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "CHORE: replace release workflow with updater-aware tauri-release pattern"
```

---

## Task 7: Pomodoro — sync local Cargo.toml version to package.json

**Files (in pomodoro-overlay):**
- Modify: `src-tauri/Cargo.toml`

CI syncs on release, but the local file is stuck at `0.1.0` while `package.json` is `0.1.3`. Fix it locally so dev/release stays consistent.

- [ ] **Step 1: Read current `package.json` version**

```bash
jq -r .version "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/package.json"
```

Expected: `0.1.3` (assuming no bump happened during Plans A/B).

- [ ] **Step 2: Update `src-tauri/Cargo.toml`**

Change line 3 from:

```toml
version = "0.1.0"
```

to:

```toml
version = "0.1.3"
```

- [ ] **Step 3: Verify cargo still compiles**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/src-tauri"
cargo check
```

Expected: passes (Cargo.lock will update).

- [ ] **Step 4: Commit**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add src-tauri/Cargo.toml src-tauri/Cargo.lock
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "CHORE: sync src-tauri/Cargo.toml version to 0.1.3"
```

---

## Task 8: Pomodoro — bump to 0.2.0 and ship

**Files (in pomodoro-overlay):**
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`

The first kit-consuming release. After this commit hits main, CI tags `tauri-v0.2.0`, builds, signs, publishes, generates `latest.json`.

- [ ] **Step 1: Bump all three version sources**

`package.json`:
```json
  "version": "0.2.0",
```

`src-tauri/tauri.conf.json`:
```json
  "version": "0.2.0",
```

`src-tauri/Cargo.toml`:
```toml
version = "0.2.0"
```

- [ ] **Step 2: Cargo update for the lock file**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay/src-tauri"
cargo update -p pomodoro-overlay --precise 0.2.0
```

If that command isn't applicable, just run `cargo check` — Cargo.lock updates automatically.

- [ ] **Step 3: Local build smoke test**

```bash
cd "C:/Users/tecno/Desktop/Projects/pomodoro-overlay"
npm run build
cd src-tauri
cargo tauri build
```

Expected: completes. Installer at `target/release/bundle/nsis/*_x64-setup.exe`. Verify the installed app reports version 0.2.0 (right-click tray, About, or via `Get-AppxPackage` if it shipped that way; alternative: `(Get-Item dist\<file>).VersionInfo.FileVersion` if Tauri stamps it).

- [ ] **Step 4: Commit and push**

```bash
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" commit -m "CHORE: bump to v0.2.0 (first kit-consuming release)"
git -C "C:/Users/tecno/Desktop/Projects/pomodoro-overlay" push origin main
```

- [ ] **Step 5: Watch the CI run**

```bash
gh run watch -R SirBepy/pomodoro-overlay
```

Or open https://github.com/SirBepy/pomodoro-overlay/actions in browser.

Expected outcomes:
- `check` job → `should_release=true`, tag `tauri-v0.2.0`
- `tag` job → creates and pushes tag
- `build` job → produces `Pomodoro-Overlay_0.2.0_windows_x64.exe` + `.sig` + `windows-x86_64.json`
- `publish` job → generates `latest.json`, uploads everything to release

- [ ] **Step 6: Verify the published release**

```bash
gh release view tauri-v0.2.0 -R SirBepy/pomodoro-overlay
```

Expected attached files: `.exe`, `.exe.sig`, `.msi`, `latest.json`.

- [ ] **Step 7: Inspect latest.json**

```bash
curl -s https://github.com/SirBepy/pomodoro-overlay/releases/latest/download/latest.json | jq .
```

Expected:
```json
{
  "version": "0.2.0",
  "notes": "Release 0.2.0",
  "pub_date": "...",
  "platforms": {
    "windows-x86_64": {
      "signature": "<minisign signature>",
      "url": "https://github.com/SirBepy/pomodoro-overlay/releases/download/tauri-v0.2.0/Pomodoro-Overlay_0.2.0_windows_x64.exe"
    }
  }
}
```

If the URL or signature is missing/wrong, the build job's "Stage Windows artifacts" step has a path bug. Fix and re-run.

---

## Task 9: End-to-end auto-update verification

**Files:** none modified.

Confirms the full handshake: an installed older version of pomodoro detects the new release, prompts, downloads, installs, restarts.

- [ ] **Step 1: Install the prior version (0.1.3) on your machine**

If a 0.1.3 installer exists from before, install it. If not, check out the v0.1.3 git tag, `cargo tauri build`, install the resulting `.exe`.

- [ ] **Step 2: Launch pomodoro 0.1.3**

Run the installed app. The kit's `checkAndPromptUpdate()` runs on load.

Expected: a Tauri dialog appears: "Version 0.2.0 is available. Install now?" with OK/Cancel.

If no dialog appears within 10 seconds:
- Open the app's webview devtools (right-click → Inspect, if `devtools` feature is enabled, otherwise check `tauri.conf.json` capabilities).
- Look for the `[tauri_kit_updater] update check failed` warning. Likely cause: pubkey mismatch, endpoint URL wrong, or `latest.json` malformed.

- [ ] **Step 3: Click OK**

Expected: download progress (Tauri default progress UI), then the app closes and re-launches. The new instance should report 0.2.0.

- [ ] **Step 4: Verify settings preserved across update**

Open settings. All your previous values (work_minutes etc.) should be intact. The settings file at `<app-data>/settings.json` was untouched by the upgrade.

If settings are wiped, the `app-data-dir` resolved differently between 0.1.3 and 0.2.0 — likely an `identifier` mismatch in `tauri.conf.json`. Spec required keeping `com.sirbepy.pomodoro-overlay` unchanged; verify it didn't get edited.

- [ ] **Step 5: Decline scenario**

Re-install 0.1.3, launch, click Cancel on the prompt. App should continue running on 0.1.3 normally. Restart the app — the prompt should appear again.

- [ ] **Step 6: No-update scenario**

Once on 0.2.0, restart. No prompt should appear (versions match). No errors in console.

- [ ] **Step 7: Document any issues found**

If the handshake is broken in a way you can't immediately fix, file a `.for_bepy/ai_todos/<id>-fix-updater-handshake.md` describing the symptom + repro and stop. Don't ship a half-working updater.

---

## Self-review checklist

Before declaring Plan C done:

- [ ] Kit `cargo check --workspace` passes
- [ ] Kit `npm test` passes (≥11 tests)
- [ ] Pomodoro `cargo tauri build` produces signed installer locally
- [ ] CI run for `tauri-v0.2.0` succeeded
- [ ] GitHub release exists with `.exe`, `.exe.sig`, `.msi`, `latest.json`
- [ ] `latest.json` parses, contains correct platform entry
- [ ] Installed 0.1.3 → prompts → upgrades to 0.2.0 successfully
- [ ] Settings file survives upgrade
- [ ] Decline path works (app keeps running on old version)
- [ ] No-update path works (no prompt when versions match)

---

## Out of scope (future work)

- macOS / Linux builds (Phase 1 explicitly Windows-only)
- claude_usage_in_taskbar migration (Phase 2, separate spec)
- Telemetry / update metrics
- Differential updates / patch payloads
- `templates/new-app/` scaffold
