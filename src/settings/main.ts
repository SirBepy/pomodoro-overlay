import "../../vendor/tauri_kit/frontend/settings/styles.css";
import { renderSettingsPage } from "../../vendor/tauri_kit/frontend/settings/renderer";
import { settingsSchema, systemInline } from "./schema";

const root = document.getElementById("root");
if (!root) throw new Error("settings root missing");

renderSettingsPage(root, {
  schema: settingsSchema,
  systemInline,
  // No app-specific danger actions for pomodoro yet (Reset is shipped by kit).
  dangerActions: [],
  // Use kit defaults for developer info; appName + appVersion auto-pulled from tauri.conf.json.
  about: {},
});
