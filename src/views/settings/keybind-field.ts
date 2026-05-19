import "./keybind-field.css";
import { html, type TemplateResult } from "lit-html";
import type { BaseField } from "../../../vendor/tauri_kit/frontend/settings/schema";

export interface KeybindFieldDef extends BaseField {
  kind: "custom";
  render: (value: unknown, onChange: (next: unknown) => void) => TemplateResult;
}

/** Maps a KeyboardEvent key string to a Tauri accelerator key name. Returns null for unsupported keys. */
function keyToAccelerator(key: string): string | null {
  if (key === " ") return "Space";
  if (key === "ArrowLeft") return "Left";
  if (key === "ArrowRight") return "Right";
  if (key === "ArrowUp") return "Up";
  if (key === "ArrowDown") return "Down";
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  return null;
}

/** Builds a Tauri accelerator string from a KeyboardEvent. Returns null if no valid combo (no modifier). */
function buildAccelerator(e: KeyboardEvent): string | null {
  const mainKey = keyToAccelerator(e.key);
  if (!mainKey) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (mods.length === 0) return null;
  return [...mods, mainKey].join("+");
}

/**
 * Enters capture mode: next keydown with a modifier sets the binding.
 * Escape cancels. Direct DOM manipulation avoids needing a re-render trigger.
 */
function startCapture(btn: HTMLButtonElement, onChange: (v: unknown) => void): void {
  btn.textContent = "Press a key…";
  btn.classList.add("recording");

  function onKey(e: KeyboardEvent): void {
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stop();
    if (e.key === "Escape") return;
    const acc = buildAccelerator(e);
    if (acc) onChange(acc);
  }

  function stop(): void {
    document.removeEventListener("keydown", onKey, true);
    if (document.contains(btn)) {
      btn.textContent = "Record";
      btn.classList.remove("recording");
    }
  }

  document.addEventListener("keydown", onKey, true);
}

/** Creates a custom keybind field definition for use in the settings schema. */
export function keybindField(
  def: Omit<KeybindFieldDef, "kind" | "render">,
): KeybindFieldDef {
  return {
    ...def,
    kind: "custom",
    render(value: unknown, onChange: (next: unknown) => void): TemplateResult {
      const current = (value as string | null | undefined) ?? null;
      return html`
        <label class="kit-row">
          <span class="kit-row-label">${def.label}</span>
          <span class="keybind-row">
            <span class="keybind-badge">${current ?? "Not set"}</span>
            <button
              type="button"
              class="kit-btn-secondary keybind-record-btn"
              @click=${(e: MouseEvent) =>
                startCapture(e.currentTarget as HTMLButtonElement, onChange)}
            >Record</button>
            ${current
              ? html`<button
                  type="button"
                  class="kit-btn-secondary"
                  @click=${() => onChange(null)}
                >Clear</button>`
              : ""}
          </span>
        </label>
      `;
    },
  };
}
