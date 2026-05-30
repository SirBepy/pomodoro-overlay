# About Page Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the About page from Settings > System > About to a top-level Settings > About nav item, and move "Reset session progress on launch" from System inline fields into Timer > Behavior.

**Architecture:** Three small, sequential changes to the kit layer (system.ts, root.ts, renderer.ts) then one schema change in the app layer. Tests are updated alongside the source file they cover so each task ends green.

**Tech Stack:** lit-html, TypeScript, Vitest, tauri_kit vendor library

---

## File Map

| File | Change |
|---|---|
| `vendor/tauri_kit/frontend/settings/pages/system.ts` | Remove `onNavAbout` dep + nav row |
| `vendor/tauri_kit/frontend/settings/pages/system.test.ts` | Remove About-related test + dep |
| `vendor/tauri_kit/frontend/settings/pages/root.ts` | Rename category, add `onNavAbout` dep + nav row |
| `vendor/tauri_kit/frontend/settings/pages/root.test.ts` | Add About dep + tests, update count |
| `vendor/tauri_kit/frontend/settings/renderer.ts` | Move `onNavAbout` from systemPage to rootPage call |
| `src/views/settings/schema.ts` | Move `reset_on_restart` field to Timer > Behavior |

---

### Task 1: Remove About from System page

**Files:**
- Modify: `vendor/tauri_kit/frontend/settings/pages/system.ts`
- Modify: `vendor/tauri_kit/frontend/settings/pages/system.test.ts`

- [ ] **Step 1: Update system.test.ts** - remove `onNavAbout` from defaultDeps and delete the About test

Replace the `defaultDeps` helper and remove the About test. The full updated file:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "lit-html";
import { systemPage } from "./system";
import type { DangerAction } from "../renderer";
import type { Field } from "../schema";

describe("systemPage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  function defaultDeps(overrides: Partial<Parameters<typeof systemPage>[0]> = {}) {
    return {
      systemInline: [] as Field[],
      dangerActions: [] as DangerAction[],
      current: {} as Record<string, unknown>,
      theme: "system" as const,
      palettes: [],
      palette: undefined,
      onChange: () => {},
      onThemeChange: () => {},
      onPaletteChange: () => {},
      onReset: () => {},
      onDanger: () => {},
      onBack: () => {},
      ...overrides,
    };
  }

  it("renders an inline theme select with the current value", () => {
    const page = systemPage(defaultDeps({ theme: "dark" }));
    render(page.render(), root);
    const select = root.querySelector<HTMLSelectElement>('select[data-key="__kit_theme"]')!;
    expect(select).toBeTruthy();
    expect(select.value).toBe("dark");
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toEqual(["system", "light", "dark"]);
  });

  it("changing the theme select calls onThemeChange with the new value", () => {
    const calls: string[] = [];
    const page = systemPage(defaultDeps({ onThemeChange: (t) => calls.push(t) }));
    render(page.render(), root);
    const select = root.querySelector<HTMLSelectElement>('select[data-key="__kit_theme"]')!;
    select.value = "light";
    select.dispatchEvent(new Event("change"));
    expect(calls).toEqual(["light"]);
  });

  it("clicking back calls onBack", () => {
    let called = false;
    const page = systemPage(defaultDeps({ onBack: () => { called = true; } }));
    render(page.render(), root);
    const back = root.querySelector<HTMLElement>(".kit-header-back")!;
    back.click();
    expect(called).toBe(true);
  });

  it("renders systemInline fields as inline rows", () => {
    const page = systemPage(defaultDeps({
      systemInline: [{ key: "autostart", kind: "toggle", label: "Launch at startup" }],
    }));
    render(page.render(), root);
    const toggle = root.querySelector<HTMLInputElement>('input[data-key="autostart"]');
    expect(toggle).toBeTruthy();
  });

  it("Reset button always renders in danger zone", () => {
    const page = systemPage(defaultDeps());
    render(page.render(), root);
    const reset = root.querySelector<HTMLButtonElement>('[data-action="reset"]');
    expect(reset).toBeTruthy();
  });

  it("dangerActions render as additional danger buttons", () => {
    const page = systemPage(defaultDeps({
      dangerActions: [{ label: "Log out", command: "logout" }],
    }));
    render(page.render(), root);
    const buttons = root.querySelectorAll(".kit-btn-danger");
    expect(buttons.length).toBe(2);
    expect(buttons[1].textContent).toContain("Log out");
  });

  it("clicking a dangerAction calls onDanger with that action", () => {
    const calls: string[] = [];
    const action: DangerAction = { label: "Log out", command: "logout" };
    const page = systemPage(defaultDeps({
      dangerActions: [action],
      onDanger: (a) => calls.push(a.command),
    }));
    render(page.render(), root);
    const logoutBtn = root.querySelectorAll<HTMLButtonElement>(".kit-btn-danger")[1];
    logoutBtn.click();
    expect(calls).toEqual(["logout"]);
  });

  const samplePalettes = [
    { id: "void", label: "Void", darkSwatch: ["#16151f"], lightSwatch: ["#f0eff5"] },
    { id: "cosmo", label: "Cosmo", darkSwatch: ["#1a0a1e"], lightSwatch: ["#faf0f4"] },
  ];

  it("renders no palette picker when no palettes are provided", () => {
    const page = systemPage(defaultDeps());
    render(page.render(), root);
    expect(root.querySelector('[data-row="palette"]')).toBeFalsy();
  });

  it("renders a palette card per provided palette and marks the active one", () => {
    const page = systemPage(defaultDeps({ palettes: samplePalettes, palette: "cosmo" }));
    render(page.render(), root);
    const cards = root.querySelectorAll(".kit-palette-card");
    expect(cards.length).toBe(2);
    const active = root.querySelector(".kit-palette-card--active");
    expect(active?.getAttribute("data-palette")).toBe("cosmo");
  });

  it("clicking a palette card calls onPaletteChange with its id", () => {
    const calls: string[] = [];
    const page = systemPage(defaultDeps({
      palettes: samplePalettes,
      palette: "void",
      onPaletteChange: (p) => calls.push(p),
    }));
    render(page.render(), root);
    root.querySelector<HTMLButtonElement>('[data-palette="cosmo"]')!.click();
    expect(calls).toEqual(["cosmo"]);
  });
});
```

- [ ] **Step 2: Update system.ts** - remove `onNavAbout` from interface and template

Replace the full file:

```ts
import { html } from "lit-html";
import type { Field } from "../schema";
import type { PageDef } from "../stack";
import { fieldRow } from "../fields";
import type { DangerAction } from "../renderer";
import { THEME_OPTIONS, type PaletteDef, type ThemeValue } from "./theme";

export interface SystemPageDeps {
  systemInline: Field[];
  dangerActions: DangerAction[];
  current: Record<string, unknown>;
  theme: ThemeValue;
  palettes: PaletteDef[];
  palette: string | undefined;
  onChange: (key: string, value: unknown) => void;
  onThemeChange: (theme: ThemeValue) => void;
  onPaletteChange: (palette: string) => void;
  onReset: () => void;
  onDanger: (action: DangerAction) => void;
  onBack: () => void;
}

export function systemPage(deps: SystemPageDeps): PageDef {
  return {
    id: "system",
    title: "System",
    render: () => html`
      <div class="kit-section">
        <label class="kit-row" data-row="theme">
          <span class="kit-row-label">Theme</span>
          <select
            data-key="__kit_theme"
            class="kit-select"
            @change=${(e: Event) =>
              deps.onThemeChange((e.target as HTMLSelectElement).value as ThemeValue)}
          >
            ${THEME_OPTIONS.map(
              (opt) => html`<option value=${opt.value} ?selected=${opt.value === deps.theme}>${opt.label}</option>`,
            )}
          </select>
        </label>
        ${deps.palettes.length
          ? html`
              <div class="kit-row kit-row--column" data-row="palette">
                <span class="kit-row-label">Palette</span>
                <div class="kit-palette-grid">
                  ${deps.palettes.map((p) => {
                    const swatch = deps.theme === "light" ? p.lightSwatch : p.darkSwatch;
                    return html`
                      <button
                        type="button"
                        class=${`kit-palette-card ${p.id === deps.palette ? "kit-palette-card--active" : ""}`}
                        data-palette=${p.id}
                        title=${p.label}
                        @click=${() => deps.onPaletteChange(p.id)}
                      >
                        <span class="kit-palette-swatch">
                          ${swatch.map((c) => html`<span style=${`background:${c}`}></span>`)}
                        </span>
                        <span class="kit-palette-label">${p.label}</span>
                      </button>
                    `;
                  })}
                </div>
              </div>
            `
          : null}
        ${deps.systemInline
          .filter((f) => !f.visibleWhen || f.visibleWhen(deps.current))
          .map((f) =>
            fieldRow(f, deps.current[f.key], (v) => deps.onChange(f.key, v)),
          )}
      </div>

      <div class="kit-section kit-section--pinned-bottom">
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

- [ ] **Step 3: Run system page tests**

Run from `vendor/tauri_kit/`:
```
npx vitest run frontend/settings/pages/system.test.ts
```
Expected: all tests pass (10 tests, 0 failures).

- [ ] **Step 4: Commit**

```
/commit
```

---

### Task 2: Add About to Root page

**Files:**
- Modify: `vendor/tauri_kit/frontend/settings/pages/root.ts`
- Modify: `vendor/tauri_kit/frontend/settings/pages/root.test.ts`

- [ ] **Step 1: Update root.test.ts** - add `onNavAbout`, update nav count from 3→4, add About test, update empty-schema test

Replace the full file:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "lit-html";
import { rootPage } from "./root";
import type { SettingsSchema } from "../schema";

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
      onNavSection: () => {},
      onNavSystem: () => {},
      onNavAbout: () => {},
      ...overrides,
    };
  }

  it("renders one nav-row per schema section plus System and About nav-rows", () => {
    const page = rootPage(defaultDeps());
    render(page.render(), root);
    const navRows = root.querySelectorAll(".kit-nav-row");
    // schema sections (2) + System (1) + About (1) = 4
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

  it("clicking System nav-row calls onNavSystem", () => {
    let called = false;
    const page = rootPage(defaultDeps({ onNavSystem: () => { called = true; } }));
    render(page.render(), root);
    const row = root.querySelector<HTMLElement>('[data-nav="system"]')!;
    row.click();
    expect(called).toBe(true);
  });

  it("clicking About nav-row calls onNavAbout", () => {
    let called = false;
    const page = rootPage(defaultDeps({ onNavAbout: () => { called = true; } }));
    render(page.render(), root);
    const row = root.querySelector<HTMLElement>('[data-nav="about"]')!;
    row.click();
    expect(called).toBe(true);
  });

  it("System and About nav-rows appear even with empty schema", () => {
    const page = rootPage(defaultDeps({ schema: { sections: [] } }));
    render(page.render(), root);
    expect(root.querySelector<HTMLElement>('[data-nav="system"]')).toBeTruthy();
    expect(root.querySelector<HTMLElement>('[data-nav="about"]')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run root tests to confirm they fail** (About row not wired yet)

```
npx vitest run frontend/settings/pages/root.test.ts
```
Expected: 2 new tests fail (`clicking About nav-row calls onNavAbout`, `System and About nav-rows appear even with empty schema`). The count test also fails.

- [ ] **Step 3: Update root.ts** - rename category, add `onNavAbout` dep, render About nav row

Replace the full file:

```ts
import { html } from "lit-html";
import type { Section, SettingsSchema } from "../schema";
import type { PageDef } from "../stack";
import { navRow } from "./parts";

export interface RootDeps {
  schema: SettingsSchema;
  onNavSection: (section: Section) => void;
  onNavSystem: () => void;
  onNavAbout: () => void;
}

function sectionId(section: Section): string {
  return `section-${section.title.toLowerCase().replace(/\s+/g, "-")}`;
}

/** Category label -> which schema section titles belong there. System and About are always appended to the last group. */
const SECTION_CATEGORIES: { label: string; titles: string[] }[] = [
  { label: "Pomodoro", titles: ["Timer", "Focus mode", "Meeting mode"] },
  { label: "Preferences", titles: ["Overlay", "Sound", "Keybinds"] },
  { label: "General", titles: ["Stats"] },
];

export function rootPage(deps: RootDeps): PageDef {
  if (deps.schema.sections.length === 0) {
    return {
      id: "root",
      title: "Settings",
      render: () => html`
        <div class="kit-section">
          ${navRow("System", "system", deps.onNavSystem)}
          ${navRow("About", "about", deps.onNavAbout)}
        </div>
      `,
    };
  }

  const byTitle = new Map(deps.schema.sections.map((s) => [s.title, s]));
  const lastCategoryIndex = SECTION_CATEGORIES.length - 1;
  const categorized = new Set(SECTION_CATEGORIES.flatMap((c) => c.titles));
  const uncategorized = deps.schema.sections.filter((s) => !categorized.has(s.title));

  return {
    id: "root",
    title: "Settings",
    render: () => html`
      ${SECTION_CATEGORIES.map(({ label, titles }, i) => {
        const sections = titles.map((t) => byTitle.get(t)).filter(Boolean) as typeof deps.schema.sections;
        const isLast = i === lastCategoryIndex;
        if (sections.length === 0 && !isLast) return null;
        return html`
          <div class="kit-section">
            <div class="kit-section-title">${label}</div>
            ${sections.map((section) =>
              navRow(section.title, sectionId(section), () => deps.onNavSection(section)),
            )}
            ${isLast ? navRow("System", "system", deps.onNavSystem) : null}
            ${isLast ? navRow("About", "about", deps.onNavAbout) : null}
          </div>
        `;
      })}
      ${uncategorized.length
        ? html`
            <div class="kit-section">
              <div class="kit-section-title">More</div>
              ${uncategorized.map((section) =>
                navRow(section.title, sectionId(section), () => deps.onNavSection(section)),
              )}
            </div>
          `
        : null}
    `,
  };
}
```

- [ ] **Step 4: Run root tests to confirm they pass**

```
npx vitest run frontend/settings/pages/root.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```
/commit
```

---

### Task 3: Update renderer.ts wiring

**Files:**
- Modify: `vendor/tauri_kit/frontend/settings/renderer.ts`

- [ ] **Step 1: Move `onNavAbout` from systemPage call to rootPage call**

In `renderer.ts`, find the `navSystem` function (around line 205). The `systemPage` call currently passes `onNavAbout: navAboutSync`. Remove it.

Then find the `stack.push(rootPage({...}))` call at the bottom (around line 231). Add `onNavAbout: navAboutSync` to the `rootPage` deps.

The `navSystem` function should become:

```ts
const navSystem = () => {
  stack.push(
    systemPage({
      systemInline: opts.systemInline ?? [],
      dangerActions: opts.dangerActions ?? [],
      current,
      palettes,
      get theme() {
        return modeOf(current);
      },
      get palette() {
        return paletteOf(current);
      },
      onChange: setField,
      onThemeChange,
      onPaletteChange,
      onReset,
      onDanger,
      onBack: () => stack.pop(),
    }),
  );
};
```

The final `stack.push(rootPage({...}))` call should become:

```ts
stack.push(
  rootPage({
    schema: opts.schema,
    onNavSection: navSection,
    onNavSystem: navSystem,
    onNavAbout: navAboutSync,
  }),
);
```

- [ ] **Step 2: Run full kit test suite**

```
npx vitest run
```
Expected: all tests pass (no regressions across the settings suite).

- [ ] **Step 3: Commit**

```
/commit
```

---

### Task 4: Move reset_on_restart to Timer > Behavior

**Files:**
- Modify: `src/views/settings/schema.ts`

- [ ] **Step 1: Update schema.ts**

In the Timer section's Behavior group (currently ends at `editable_when_paused`), append `reset_on_restart`. Then remove it from `systemInline`.

The Behavior group fields array becomes:

```ts
{
  title: "Behavior",
  fields: [
    {
      key: "auto_start_work",
      kind: "toggle",
      label: "Auto-start work phase",
      tooltip:
        "When a break ends, immediately start the next focus session.",
    },
    {
      key: "auto_start_break",
      kind: "toggle",
      label: "Auto-start break phase",
      tooltip:
        "When a focus session ends, immediately start the break.",
    },
    {
      key: "editable_when_paused",
      kind: "toggle",
      label: "Edit timer while paused",
      tooltip:
        "When paused, click the time digits to manually adjust them. Off = read-only.",
    },
    {
      key: "reset_on_restart",
      kind: "toggle",
      label: "Reset session progress on launch",
      tooltip:
        "When on, every app launch starts at session 1. When off, your previous unfinished session resumes.",
    },
  ],
},
```

The `systemInline` export at the bottom of the file becomes:

```ts
export const systemInline = [
  {
    key: "autostart",
    kind: "toggle" as const,
    label: "Launch at startup",
    tooltip: "Run the overlay automatically when Windows starts.",
  },
];
```

- [ ] **Step 2: Run TypeScript build to verify no type errors**

```
npm run build
```
Expected: exits 0, no TS errors.

- [ ] **Step 3: Commit**

```
/commit
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full kit test suite one more time**

From `vendor/tauri_kit/`:
```
npx vitest run
```
Expected: all tests pass.

- [ ] **Step 2: Run Rust check**

From `src-tauri/`:
```
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: no errors (settings.rs struct already has both `autostart` and `reset_on_restart` fields).

- [ ] **Step 3: Verify TS build**

```
npm run build
```
Expected: exits 0.
