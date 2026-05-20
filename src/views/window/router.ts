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
        <i class="ph ph-arrow-left"></i> Settings
      </button>
    </div>
  `;
  headerEl.querySelector("#back-to-dashboard")!.addEventListener("click", () => {
    location.hash = "#dashboard";
  });
}

export function renderDashboardHeader(
  selectedDayStart: number,
  earliestDayStart: number,
  onNavigate: (newDayStart: number) => void,
): void {
  const now = Date.now();
  const todayStart = startOfDay(now);
  const isPrevDisabled = selectedDayStart <= earliestDayStart;
  const isNextDisabled = selectedDayStart >= todayStart;

  const dateLabel = new Date(selectedDayStart).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });

  const minDate = new Date(earliestDayStart).toISOString().slice(0, 10);
  const maxDate = new Date(todayStart).toISOString().slice(0, 10);
  const currentDate = new Date(selectedDayStart).toISOString().slice(0, 10);

  headerEl.innerHTML = `
    <div class="ctx-header ctx-header-dashboard">
      <span class="ctx-title">Dashboard</span>
      <div class="ctx-date-nav">
        <button class="ctx-nav-btn" id="nav-prev" ${isPrevDisabled ? "disabled" : ""}>
          <i class="ph ph-caret-left"></i>
        </button>
        <input type="date" class="ctx-date-picker" id="date-picker"
          value="${currentDate}" min="${minDate}" max="${maxDate}">
        <button class="ctx-nav-btn" id="nav-next" ${isNextDisabled ? "disabled" : ""}>
          <i class="ph ph-caret-right"></i>
        </button>
      </div>
      <button class="ctx-cog-btn" id="open-settings" title="Settings">
        <i class="ph ph-gear"></i>
      </button>
    </div>
  `;

  headerEl.querySelector("#nav-prev")!.addEventListener("click", () => {
    if (!isPrevDisabled) onNavigate(selectedDayStart - 86_400_000);
  });
  headerEl.querySelector("#nav-next")!.addEventListener("click", () => {
    if (!isNextDisabled) onNavigate(selectedDayStart + 86_400_000);
  });
  headerEl.querySelector("#date-picker")!.addEventListener("change", (ev) => {
    const val = (ev.target as HTMLInputElement).value;
    if (val) onNavigate(startOfDay(new Date(val).getTime()));
  });
  headerEl.querySelector("#open-settings")!.addEventListener("click", () => {
    location.hash = "#settings";
  });
}

// startOfDay helper (duplicates rollup.ts to avoid circular import)
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function mount() {
  const route = currentRoute();
  teardownDashboard();
  bodyEl.innerHTML = "";
  if (route === "settings") {
    renderSettingsHeader();
    mountSettings(bodyEl);
  } else {
    mountDashboard(bodyEl, headerEl, renderDashboardHeader);
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
