import type { CardHelpers } from "../hass";

let lovelaceLoad: Promise<void> | undefined;

// HA defines window.loadCardHelpers only after its dashboard code loads, and a
// user who opens this panel first has not loaded it. Asking HA's panel
// resolver to load the lovelace panel module defines it. The resolver is
// internal, so this is isolated here, and any failure leaves the caller to
// fall back to a link.
function loadLovelace(): Promise<void> {
  lovelaceLoad ??= (async () => {
    type Resolver = HTMLElement & {
      hass: unknown;
      _updateRoutes(): void;
      routerOptions: { routes: Record<string, { load(): Promise<unknown> }> };
    };
    const resolver = document.createElement("partial-panel-resolver") as Resolver;
    resolver.hass = { panels: [{ url_path: "entity-explorer-cards", component_name: "lovelace" }] };
    resolver._updateRoutes();
    await resolver.routerOptions.routes["entity-explorer-cards"].load();
  })().catch((err) => console.warn("entity-explorer: could not load card helpers", err));
  return lovelaceLoad;
}

export async function cardHelpers(): Promise<CardHelpers | undefined> {
  if (!window.loadCardHelpers) await loadLovelace();
  return window.loadCardHelpers?.();
}
