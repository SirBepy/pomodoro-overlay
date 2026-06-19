import "./phone-pairing-field.css";
import { html, type TemplateResult } from "lit-html";
import type { BaseField } from "../../../vendor/tauri_kit/frontend/settings/schema";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

export interface PhonePairingFieldDef extends BaseField {
  kind: "custom";
  render: (value: unknown, onChange: (next: unknown) => void) => TemplateResult;
}

/**
 * The custom `render` returns a one-shot static template (the vendor renderer
 * calls it once and never re-renders on internal state changes). So all
 * mutable UI - status line, transient toasts, the re-pair banner - is driven
 * by direct DOM manipulation against ids stamped into the template, the same
 * approach the kit keybind field uses for its capture state.
 */

const STATUS_ID = "phone-pairing-status";
const TOAST_ID = "phone-pairing-toast";
const BANNER_ID = "phone-pairing-banner";

function setStatus(paired: boolean): void {
  const el = document.getElementById(STATUS_ID);
  if (!el) return;
  el.textContent = paired ? "Paired ✓" : "Not paired";
  el.classList.toggle("phone-pairing-status--paired", paired);
}

async function refreshStatus(): Promise<void> {
  try {
    const paired = (await invoke("get_pairing_status")) as boolean;
    setStatus(paired);
  } catch {
    setStatus(false);
  }
}

let toastTimer: number | undefined;

function showToast(message: string, isError: boolean): void {
  const el = document.getElementById(TOAST_ID);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("phone-pairing-toast--error", isError);
  el.classList.add("phone-pairing-toast--visible");
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.classList.remove("phone-pairing-toast--visible");
  }, 4000);
}

/** Subscribe once to push-subscription-gone; show the re-pair banner when it fires. */
let unlisten: (() => void) | undefined;
function ensureSubscriptionGoneListener(): void {
  if (unlisten) return;
  listen("push-subscription-gone", () => {
    setStatus(false);
    const banner = document.getElementById(BANNER_ID);
    if (banner) banner.classList.add("phone-pairing-banner--visible");
  }).then((un: () => void) => {
    unlisten = un;
  });
}

/** Creates a custom phone-pairing field definition for use in the settings schema. */
export function phonePairingField(
  def: Omit<PhonePairingFieldDef, "kind" | "render">,
): PhonePairingFieldDef {
  return {
    ...def,
    kind: "custom",
    render(): TemplateResult {
      // Fire-and-forget on mount: prime the status line and wire the listener.
      // queueMicrotask defers until after lit-html has inserted the nodes.
      queueMicrotask(() => {
        void refreshStatus();
        ensureSubscriptionGoneListener();
      });

      const onPair = async (e: MouseEvent): Promise<void> => {
        const btn = e.currentTarget as HTMLButtonElement;
        const input = document.getElementById(
          "phone-pairing-code",
        ) as HTMLInputElement | null;
        const code = input?.value.trim() ?? "";
        if (!code) {
          showToast("Enter a pairing code first.", true);
          return;
        }
        btn.disabled = true;
        try {
          await invoke("pair_phone", { code });
          if (input) input.value = "";
          showToast("Paired ✓", false);
          await refreshStatus();
        } catch (err) {
          showToast(String(err), true);
        } finally {
          btn.disabled = false;
        }
      };

      const onTest = async (e: MouseEvent): Promise<void> => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        try {
          await invoke("send_test_push");
          showToast("Test sent — check your phone.", false);
        } catch (err) {
          showToast(String(err), true);
        } finally {
          btn.disabled = false;
        }
      };

      const onCopyKey = async (e: MouseEvent): Promise<void> => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        try {
          const key = (await invoke("get_vapid_public_key")) as string;
          if (!key) {
            showToast("No key yet — launch the app once to generate it.", true);
            return;
          }
          await navigator.clipboard.writeText(key);
          showToast("VAPID public key copied.", false);
        } catch (err) {
          showToast(String(err), true);
        } finally {
          btn.disabled = false;
        }
      };

      const dismissBanner = (e: MouseEvent): void => {
        const banner = (e.currentTarget as HTMLElement).closest(
          `#${BANNER_ID}`,
        );
        banner?.classList.remove("phone-pairing-banner--visible");
      };

      return html`
        <div class="phone-pairing">
          <div id=${BANNER_ID} class="phone-pairing-banner" role="alert">
            <i class="ph ph-warning" aria-hidden="true"></i>
            <span class="phone-pairing-banner-text"
              >Your phone was unpaired by the push service. Re-pair to keep
              getting alerts.</span
            >
            <button
              type="button"
              class="phone-pairing-banner-dismiss"
              aria-label="Dismiss"
              @click=${dismissBanner}
            >
              <i class="ph ph-x" aria-hidden="true"></i>
            </button>
          </div>

          <label class="kit-row">
            <span class="kit-row-label">${def.label}</span>
            <span class="phone-pairing-controls">
              <input
                id="phone-pairing-code"
                type="text"
                class="kit-input phone-pairing-input"
                placeholder="Pairing code"
                autocomplete="off"
                spellcheck="false"
              />
              <button
                type="button"
                class="kit-btn-primary"
                @click=${onPair}
              >Pair</button>
            </span>
          </label>

          <div class="kit-row phone-pairing-statusrow">
            <span class="kit-row-label">Status</span>
            <span class="phone-pairing-statusgroup">
              <span id=${STATUS_ID} class="phone-pairing-status"
                >Not paired</span
              >
              <button
                type="button"
                class="kit-btn-secondary"
                @click=${onTest}
              >Send test push</button>
            </span>
          </div>

          <div class="kit-row phone-pairing-statusrow">
            <span class="kit-row-label">VAPID public key</span>
            <span class="phone-pairing-statusgroup">
              <button
                type="button"
                class="kit-btn-secondary"
                @click=${onCopyKey}
              ><i class="ph ph-copy" aria-hidden="true"></i> Copy</button>
            </span>
          </div>

          <div id=${TOAST_ID} class="phone-pairing-toast" role="status"></div>
        </div>
      `;
    },
  };
}
