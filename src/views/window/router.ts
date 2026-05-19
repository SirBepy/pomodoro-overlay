import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import "../../styles/dashboard.css";
import { mountSettings } from "../settings/settings";
import { mountDashboard } from "../dashboard/dashboard";
import { renderTabs, RouteName } from "./tabs";

const root = document.getElementById("root");
if (!root) throw new Error("window root missing");

root.innerHTML = `
  <div id="window-tabs"></div>
  <div id="window-body"></div>
`;
const tabsEl = root.querySelector<HTMLElement>("#window-tabs")!;
const bodyEl = root.querySelector<HTMLElement>("#window-body")!;

function currentRoute(): RouteName {
  const h = (location.hash || "#dashboard").replace(/^#/, "");
  return h === "settings" ? "settings" : "dashboard";
}

function mount() {
  const route = currentRoute();
  renderTabs(tabsEl, route, (next) => {
    location.hash = `#${next}`;
  });
  bodyEl.innerHTML = "";
  if (route === "dashboard") mountDashboard(bodyEl);
  else mountSettings(bodyEl);
}

window.addEventListener("hashchange", mount);
mount();
