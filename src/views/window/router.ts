import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import "../../../vendor/tauri_kit/frontend/settings/styles.css";
import "../../styles/dashboard.css";
import { applyTheme } from "../../../vendor/tauri_kit/frontend/settings/pages/theme";
import { mountAppBar } from "./app-bar";
import { mountSettings } from "../settings/settings";
import { mountDashboard, teardown as teardownDashboard } from "../dashboard/dashboard";
import { mountSessions, teardown as teardownSessions } from "../dashboard/sessions-screen";

// @ts-ignore
const { invoke } = window.__TAURI__.core;

export type RouteName = "dashboard" | "settings" | "sessions";

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
  if (h === "settings") return "settings";
  if (h === "sessions") return "sessions";
  return "dashboard";
}

function onSettingsPageChange(title: string, depth: number, pop: () => void): void {
  if (depth <= 1) {
    mountAppBar(headerEl, {
      title,
      leading: { icon: "arrow-left", action: () => { location.hash = "#dashboard"; } },
    });
  } else {
    mountAppBar(headerEl, {
      title,
      leading: { icon: "arrow-left", action: pop },
    });
  }
}

export function renderDashboardHeader(): void {
  mountAppBar(headerEl, {
    title: "Dashboard",
    trailing: { icon: "gear", action: () => { location.hash = "#settings"; }, title: "Settings" },
  });
}

function mount() {
  const route = currentRoute();
  teardownDashboard();
  teardownSessions();
  bodyEl.innerHTML = "";
  if (route === "settings") {
    mountSettings(bodyEl, { onHeaderChange: onSettingsPageChange });
  } else if (route === "sessions") {
    mountAppBar(headerEl, {
      title: "Sessions",
      leading: { icon: "arrow-left", action: () => { location.hash = "#dashboard"; } },
    });
    mountSessions(bodyEl);
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
