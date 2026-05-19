export type RouteName = "dashboard" | "settings";

export function renderTabs(container: HTMLElement, active: RouteName, onSelect: (r: RouteName) => void) {
  container.innerHTML = `
    <div class="window-tabs">
      <button class="window-tab" data-route="dashboard">Dashboard</button>
      <button class="window-tab" data-route="settings">Settings</button>
    </div>
  `;
  container.querySelectorAll<HTMLButtonElement>(".window-tab").forEach((btn) => {
    const route = btn.dataset.route as RouteName;
    btn.classList.toggle("active", route === active);
    btn.addEventListener("click", () => onSelect(route));
  });
}
