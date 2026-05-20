import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import "../../../vendor/tauri_kit/frontend/settings/styles.css";
import "../../styles/dashboard.css";
import { applyTheme } from "../../../vendor/tauri_kit/frontend/settings/pages/theme";
import { mountSettings } from "../settings/settings";
import { mountDashboard, teardown as teardownDashboard } from "../dashboard/dashboard";

// @ts-ignore
const { invoke } = window.__TAURI__.core;

export type RouteName = "dashboard" | "settings";

const root = document.getElementById("root");
if (!root) throw new Error("window root missing");

root.innerHTML = `
  <div id="window-header"></div>
  <div id="window-body"></div>
`;

const headerEl = root.querySelector<HTMLElement>("#window-header")!;
const bodyEl = root.querySelector<HTMLElement>("#window-body")!;

function currentRoute(): RouteName {
  const h = (location.hash || "#dashboard").replace(/^#/, "");
  return h === "settings" ? "settings" : "dashboard";
}

function renderSettingsHeader(): void {
  headerEl.innerHTML = `
    <div class="ctx-header ctx-header-settings">
      <button class="ctx-back-btn" id="back-to-dashboard">
        <i class="ph ph-arrow-left"></i>
      </button>
      <span class="ctx-title">Settings</span>
    </div>
  `;
  headerEl.querySelector("#back-to-dashboard")!.addEventListener("click", () => {
    location.hash = "#dashboard";
  });
}

export function renderDashboardHeader(): void {
  headerEl.innerHTML = `
    <div class="ctx-header ctx-header-dashboard">
      <span class="ctx-title">Dashboard</span>
      <button class="ctx-cog-btn" id="open-settings" title="Settings">
        <i class="ph ph-gear"></i>
      </button>
    </div>
  `;
  headerEl.querySelector("#open-settings")!.addEventListener("click", () => {
    location.hash = "#settings";
  });
}

function mount() {
  const route = currentRoute();
  teardownDashboard();
  bodyEl.innerHTML = "";
  if (route === "settings") {
    renderSettingsHeader();
    mountSettings(bodyEl);
  } else {
    mountDashboard(bodyEl, renderDashboardHeader);
  }
}

window.addEventListener("hashchange", mount);

(async () => {
  try {
    const s = await invoke<any>("get_settings");
    applyTheme(s?.__kit_theme ?? "system");
  } catch {
    applyTheme("system");
  }
  mount();
})();
