import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import "../../../vendor/tauri_kit/frontend/settings/styles.css";
import { renderSettingsPage, type RenderOptions } from "../../../vendor/tauri_kit/frontend/settings/renderer";
import { settingsSchema, systemInline } from "./schema";

export function mountSettings(root: HTMLElement, extra?: Pick<RenderOptions, "onHeaderChange">) {
  renderSettingsPage(root, {
    schema: settingsSchema,
    systemInline,
    dangerActions: [],
    about: {},
    ...extra,
  });
}
