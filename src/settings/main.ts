import "../../vendor/tauri_kit/frontend/settings/styles.css";
import { renderSettingsPage } from "../../vendor/tauri_kit/frontend/settings/renderer";
import { settingsSchema } from "./schema";

const root = document.getElementById("root");
if (!root) throw new Error("settings root missing");

renderSettingsPage(root, { schema: settingsSchema });
