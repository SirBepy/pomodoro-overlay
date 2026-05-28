import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import "../../../vendor/tauri_kit/frontend/settings/styles.css";
import "../../../vendor/tauri_kit/frontend/settings/palettes/sirbepy-default.css";
import { renderSettingsPage, type RenderOptions } from "../../../vendor/tauri_kit/frontend/settings/renderer";
import { SIRBEPY_PALETTES, SIRBEPY_DEFAULT_PALETTE } from "../../../vendor/tauri_kit/frontend/settings/palettes/sirbepy-default";
import { settingsSchema, systemInline } from "./schema";

export function mountSettings(root: HTMLElement, extra?: Pick<RenderOptions, "onHeaderChange">) {
  renderSettingsPage(root, {
    schema: settingsSchema,
    systemInline,
    dangerActions: [],
    about: {},
    palettes: SIRBEPY_PALETTES,
    theme: { defaultPalette: SIRBEPY_DEFAULT_PALETTE },
    ...extra,
  });
}
