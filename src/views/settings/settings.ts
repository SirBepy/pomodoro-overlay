import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import "../../../vendor/tauri_kit/frontend/settings/styles.css";
import { renderSettingsPage } from "../../../vendor/tauri_kit/frontend/settings/renderer";
import { settingsSchema, systemInline } from "./schema";

export function mountSettings(root: HTMLElement) {
  renderSettingsPage(root, {
    schema: settingsSchema,
    systemInline,
    // No app-specific danger actions for pomodoro yet (Reset is shipped by kit).
    dangerActions: [],
    // Use kit defaults for developer info; appName + appVersion auto-pulled from tauri.conf.json.
    about: {},
  });
}
