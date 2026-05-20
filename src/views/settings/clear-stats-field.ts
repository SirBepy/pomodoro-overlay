import { html, type TemplateResult } from "lit-html";
import type { BaseField } from "../../../vendor/tauri_kit/frontend/settings/schema";
import { resetStats } from "../../shared/stats";

export interface ClearStatsFieldDef extends BaseField {
  kind: "custom";
  render: (value: unknown, onChange: (next: unknown) => void) => TemplateResult;
}

/** A danger-zone button that wipes all stats history (with a confirm prompt). */
export function clearStatsField(
  def: Omit<ClearStatsFieldDef, "kind" | "render">,
): ClearStatsFieldDef {
  return {
    ...def,
    kind: "custom",
    render(): TemplateResult {
      return html`
        <div class="kit-row" style="border-top: 1px solid var(--kit-border)">
          <button
            type="button"
            class="kit-btn-danger"
            data-action="clear-stats"
            @click=${async () => {
              const ok = window.confirm(
                "Permanently delete all stats history? This cannot be undone.",
              );
              if (!ok) return;
              await resetStats();
            }}
          >Clear stats</button>
        </div>
      `;
    },
  };
}
