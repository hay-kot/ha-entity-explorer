import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";

import { cardHelpers } from "../data/cards";
import { define } from "../define";
import type { HomeAssistant, LovelaceCard } from "../hass";
import { domainIcon, entityIcon } from "../icons";
import { isActive, isUnavailable, relativeTime } from "../state";
import type { Registry, TreeNode, ViewId } from "../tree/model";
import { entityNodes, type NodeHit } from "../tree/rows";
import { VIEWS } from "../views";

export interface ViewReference {
  view: ViewId;
  hits: NodeHit[];
}

type EntityTab = "state" | "history" | "references" | "settings";
type FolderTab = "items" | "details";

type Related = Partial<Record<string, string[]>>;

const USED_BY_KINDS: [kind: string, icon: string][] = [
  ["automation", "mdi:robot-outline"],
  ["script", "mdi:script-text-outline"],
  ["scene", "mdi:palette-outline"],
  ["group", "mdi:google-circles-communities"],
];

// A folder can hold every entity in the install. The full, virtualized and
// sortable Items table is later work, so the table stops here.
const ITEMS_LIMIT = 200;

// Same mechanism as HA's own navigate(): push the URL, then tell the app.
function navigate(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

function settingsPath(node: TreeNode): string | undefined {
  if (node.deviceId) return `/config/devices/device/${node.deviceId}`;
  if (node.areaId) return `/config/areas/area/${node.areaId}`;
  if (node.kind === "integration" && node.domain) {
    return `/config/integrations/integration/${node.domain}`;
  }
  if (node.kind === "label") return "/config/labels";
  return undefined;
}

// Events:
//   ee-select  detail: node id in the current view
//   ee-reveal  detail: { view, nodeId }
export class EntityExplorerDetailPane extends LitElement {
  static properties = {
    hass: { attribute: false },
    registry: { attribute: false },
    view: { attribute: false },
    node: { attribute: false },
    ancestors: { attribute: false },
    references: { attribute: false },
    entityTab: { state: true },
    folderTab: { state: true },
    related: { state: true },
  };

  declare hass: HomeAssistant;
  declare registry: Registry;
  declare view: ViewId;
  declare node?: TreeNode;
  declare ancestors: TreeNode[];
  declare references: ViewReference[];

  declare private entityTab: EntityTab;
  declare private folderTab: FolderTab;
  declare private related: Map<string, Related | "loading" | "error">;

  // undefined while loading, null when card helpers are unavailable.
  private historyCard?: LovelaceCard | null;
  private historyEntity?: string;

  constructor() {
    super();
    this.ancestors = [];
    this.references = [];
    this.entityTab = "state";
    this.folderTab = "items";
    this.related = new Map();
  }

  protected willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    const entityId = this.node?.entityId;
    if (!entityId) return;
    if (this.entityTab === "history" && this.historyEntity !== entityId) {
      this.loadHistoryCard(entityId);
    }
    if (this.entityTab === "references" && !this.related.has(entityId)) {
      this.loadRelated(entityId);
    }
  }

  protected updated(changed: PropertyValues) {
    super.updated(changed);
    if (this.historyCard && changed.has("hass")) this.historyCard.hass = this.hass;
  }

  private async loadHistoryCard(entityId: string) {
    this.historyEntity = entityId;
    this.historyCard = undefined;
    const helpers = await cardHelpers();
    if (this.historyEntity !== entityId) return;
    if (!helpers) {
      this.historyCard = null;
      this.requestUpdate();
      return;
    }
    const card = helpers.createCardElement({
      type: "history-graph",
      entities: [entityId],
      hours_to_show: 24,
    });
    card.hass = this.hass;
    this.historyCard = card;
    this.requestUpdate();
  }

  private async loadRelated(entityId: string) {
    this.related = new Map(this.related).set(entityId, "loading");
    let result: Related | "error";
    try {
      result = await this.hass.callWS<Related>({
        type: "search/related",
        item_type: "entity",
        item_id: entityId,
      });
    } catch (err) {
      console.warn("entity-explorer: search/related failed", err);
      result = "error";
    }
    this.related = new Map(this.related).set(entityId, result);
  }

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private moreInfo(entityId: string, view?: "settings") {
    this.emit("hass-more-info", view ? { entityId, view } : { entityId });
  }

  render() {
    const node = this.node;
    if (!node) return html`<div class="card hint">Select an item in the tree.</div>`;
    return node.entityId ? this.renderEntity(node, node.entityId) : this.renderFolder(node);
  }

  // ---------- Shared header pieces ----------

  private renderCrumbs(extra: TemplateResult | typeof nothing = nothing) {
    return html`
      <div class="crumbs">
        <ha-icon .icon=${VIEWS[this.view].icon}></ha-icon>
        ${this.ancestors.map(
          (a, i) => html`${i ? html`<span class="sep">›</span>` : nothing}<button
              class="crumb"
              @click=${() => this.emit("ee-select", a.id)}
            >
              ${a.label}
            </button>`,
        )}
        ${extra}
      </div>
    `;
  }

  private renderTabs<T extends string>(
    tabs: [T, string, string][],
    current: T,
    select: (tab: T) => void,
  ) {
    return html`
      <div class="tabs" role="tablist">
        ${tabs.map(
          ([id, label, icon]) => html`
            <button role="tab" aria-selected=${current === id} @click=${() => select(id)}>
              <ha-icon .icon=${icon}></ha-icon>${label}
            </button>
          `,
        )}
      </div>
    `;
  }

  // ---------- Entity ----------

  private renderEntity(node: TreeNode, entityId: string) {
    const stateObj = this.hass.states[entityId];
    const otherViews = this.references.filter((r) => r.hits.length && r.view !== this.view).length;
    const tabs: [EntityTab, string, string][] = [
      ["state", "State", "mdi:information-outline"],
      ["history", "History", "mdi:chart-line"],
      ["references", "References", "mdi:sitemap-outline"],
      ["settings", "Settings", "mdi:cog-outline"],
    ];

    return html`
      <div class="card head">
        ${this.renderCrumbs(
          otherViews
            ? html`<button class="also" @click=${() => (this.entityTab = "references")}>
                <ha-icon icon="mdi:sitemap-outline"></ha-icon>also in ${otherViews}
                ${otherViews === 1 ? "view" : "views"}
              </button>`
            : nothing,
        )}
        <div class="title">
          <div
            class="badge ${isActive(stateObj) ? "active" : ""} ${isUnavailable(stateObj) ? "bad" : ""}"
          >
            <ha-icon .icon=${entityIcon(this.hass, entityId)}></ha-icon>
          </div>
          <div class="name">
            <h2>${node.label}</h2>
            <div class="mono">${entityId}</div>
          </div>
          ${stateObj
            ? html`<div class="state">
                <div class="value ${isUnavailable(stateObj) ? "bad" : ""}">
                  ${this.hass.formatEntityState(stateObj)}
                </div>
                <div class="since">${relativeTime(stateObj.last_changed, this.hass.locale.language)}</div>
              </div>`
            : nothing}
        </div>
        ${this.renderTabs(tabs, this.entityTab, (tab) => (this.entityTab = tab))}
      </div>
      <div class="card body">${this.renderEntityTab(entityId)}</div>
    `;
  }

  private renderEntityTab(entityId: string) {
    switch (this.entityTab) {
      case "state":
        return this.renderAttributes(entityId);
      case "history":
        if (this.historyCard) return html`<div class="embedded">${this.historyCard}</div>`;
        if (this.historyCard === null) {
          return html`<p class="muted">History cards are not available here.</p>
            <div class="actions">
              <button class="text" @click=${() => navigate(`/history?entity_id=${entityId}`)}>
                <ha-icon icon="mdi:chart-line"></ha-icon>Open in History
              </button>
            </div>`;
        }
        return html`<p class="muted">Loading history…</p>`;
      case "references":
        return this.renderReferences(entityId);
      case "settings":
        return html`
          <p class="muted">
            Name, area, icon, device class and other entity options are edited in Home Assistant's
            own settings dialog.
          </p>
          <div class="actions">
            <button class="text" @click=${() => this.moreInfo(entityId, "settings")}>
              <ha-icon icon="mdi:cog-outline"></ha-icon>Open entity settings
            </button>
            <button class="text" @click=${() => this.moreInfo(entityId)}>
              <ha-icon icon="mdi:information-outline"></ha-icon>More info
            </button>
          </div>
        `;
    }
  }

  private renderAttributes(entityId: string) {
    const stateObj = this.hass.states[entityId];
    const entry = this.registry.entities[entityId];
    const device = entry?.device_id ? this.hass.devices[entry.device_id] : undefined;
    const integration = entry?.platform
      ? (this.registry.integrationNames[entry.platform] ?? entry.platform)
      : undefined;
    const footer = [
      device ? [device.manufacturer, device.model].filter(Boolean).join(" ") : undefined,
      integration,
      entry?.entity_category,
      entry?.hidden ? "hidden" : undefined,
    ].filter(Boolean);

    return html`
      <h3>Attributes</h3>
      ${stateObj
        ? html`<table class="kv">
            ${Object.keys(stateObj.attributes).map(
              (key) => html`<tr>
                <td class="mono">${key}</td>
                <td>${this.hass.formatEntityAttributeValue(stateObj, key)}</td>
              </tr>`,
            )}
            <tr>
              <td class="mono">last_changed</td>
              <td>${relativeTime(stateObj.last_changed, this.hass.locale.language)}</td>
            </tr>
          </table>`
        : html`<p class="muted">This entity has no state. It may be disabled.</p>`}
      ${footer.length
        ? html`<div class="footnote">
            <ha-icon icon="mdi:information-outline"></ha-icon>${footer.join(" · ")}
          </div>`
        : nothing}
    `;
  }

  private renderReferences(entityId: string) {
    const related = this.related.get(entityId);
    const usedBy =
      related && related !== "loading" && related !== "error"
        ? USED_BY_KINDS.flatMap(([kind, icon]) => (related[kind] ?? []).map((id) => ({ id, icon })))
        : [];

    return html`
      <div class="refs">
        ${this.references.map(({ view, hits }) =>
          hits.length
            ? hits.map(
                (hit, i) => html`
                  <div class="ref ${view === this.view && hit.node.id === this.node?.id ? "current" : ""}">
                    ${i === 0 ? html`<ha-icon .icon=${VIEWS[view].icon}></ha-icon>` : html`<span></span>`}
                    <span class="view-name">${i === 0 ? VIEWS[view].name : ""}</span>
                    <span class="path">${hit.ancestors.map((a) => a.label).join(" › ")}</span>
                    <button
                      class="text"
                      ?disabled=${view === this.view && hit.node.id === this.node?.id}
                      @click=${() => this.emit("ee-reveal", { view, nodeId: hit.node.id })}
                    >
                      <ha-icon icon="mdi:crosshairs-gps"></ha-icon>Reveal
                    </button>
                  </div>
                `,
              )
            : html`<div class="ref">
                <ha-icon .icon=${VIEWS[view].icon}></ha-icon>
                <span class="view-name">${VIEWS[view].name}</span>
                <span class="path muted">Not in this view</span>
                <span></span>
              </div>`,
        )}
      </div>
      <h3>Used by</h3>
      ${related === undefined || related === "loading"
        ? html`<p class="muted">Looking for automations, scripts and scenes…</p>`
        : related === "error"
          ? html`<p class="muted">Could not search for references.</p>`
          : usedBy.length
            ? html`<div class="used-by">
                ${usedBy.map(
                  ({ id, icon }) => html`<button @click=${() => this.moreInfo(id)}>
                    <ha-icon .icon=${icon}></ha-icon>${this.hass.states[id]?.attributes.friendly_name ?? id}
                  </button>`,
                )}
              </div>`
            : html`<p class="muted">Not used by any automation, script, scene or group.</p>`}
    `;
  }

  // ---------- Folder ----------

  private renderFolder(node: TreeNode) {
    const device = node.deviceId ? this.hass.devices[node.deviceId] : undefined;
    const subtitle = device
      ? [device.manufacturer, device.model].filter(Boolean).join(" ") || "device"
      : node.kind === "group"
        ? "group"
        : node.kind;
    const icon =
      node.icon ??
      (node.kind === "device"
        ? "mdi:devices"
        : node.kind === "domain"
          ? domainIcon(node.domain ?? "")
          : "mdi:folder-outline");
    const tabs: [FolderTab, string, string][] = [
      ["items", "Items", "mdi:format-list-bulleted"],
      ["details", "Details", "mdi:information-outline"],
    ];

    return html`
      <div class="card head">
        ${this.renderCrumbs()}
        <div class="title">
          <div class="badge folder"><ha-icon .icon=${icon}></ha-icon></div>
          <div class="name">
            <h2>${node.label}</h2>
            <div class="mono">${subtitle}</div>
          </div>
        </div>
        ${node.partial
          ? html`<div class="banner">
              <ha-icon icon="mdi:call-split"></ha-icon>
              This device lives in ${this.deviceAreaName(node.deviceId)}. Only ${node.partial} of its
              entities resolve to this area.
            </div>`
          : nothing}
        ${this.renderTabs(tabs, this.folderTab, (tab) => (this.folderTab = tab))}
      </div>
      <div class="card body">
        ${this.folderTab === "items" ? this.renderItems(node) : this.renderDetails(node)}
      </div>
    `;
  }

  private deviceAreaName(deviceId?: string): string {
    const areaId = deviceId ? this.hass.devices[deviceId]?.area_id : undefined;
    return areaId ? (this.hass.areas[areaId]?.name ?? areaId) : "no area";
  }

  private areaName(entityId: string): string {
    const entry = this.registry.entities[entityId];
    const areaId =
      entry?.area_id ?? (entry?.device_id ? this.hass.devices[entry.device_id]?.area_id : null);
    return areaId ? (this.hass.areas[areaId]?.name ?? "") : "";
  }

  private renderItems(node: TreeNode) {
    const entities = entityNodes(node);
    const devices = new Set(
      entities
        .map((e) => this.registry.entities[e.entityId!]?.device_id)
        .filter((id): id is string => Boolean(id)),
    );
    const states = entities.map((e) => this.hass.states[e.entityId!]);
    const tiles: [string, number, string][] = [
      ["Entities", entities.length, ""],
      ["Devices", devices.size, ""],
      ["On / active", states.filter(isActive).length, "active"],
      ["Unavailable", states.filter(isUnavailable).length, "bad"],
    ];

    return html`
      <div class="tiles">
        ${tiles.map(
          ([label, value, tone]) => html`<div class="tile">
            <div class="tile-value ${value ? tone : ""}">${value}</div>
            <div class="tile-label">${label}</div>
          </div>`,
        )}
      </div>
      <table class="items">
        <colgroup>
          <col class="col-name" />
          <col class="col-id" />
          <col class="col-state" />
          <col class="col-area" />
        </colgroup>
        <thead>
          <tr>
            <th>Name</th>
            <th>Entity ID</th>
            <th>State</th>
            <th>Area</th>
          </tr>
        </thead>
        <tbody>
          ${entities.slice(0, ITEMS_LIMIT).map((e) => {
            const stateObj = this.hass.states[e.entityId!];
            return html`<tr @click=${() => this.emit("ee-select", e.id)}>
              <td>
                <span class="item-name">
                  <ha-icon
                    class=${isActive(stateObj) ? "active" : ""}
                    .icon=${entityIcon(this.hass, e.entityId!)}
                  ></ha-icon
                  >${e.label}
                </span>
              </td>
              <td class="mono">${e.entityId}</td>
              <td class=${isUnavailable(stateObj) ? "bad" : ""}>
                ${stateObj ? this.hass.formatEntityState(stateObj) : "-"}
              </td>
              <td>${this.areaName(e.entityId!)}</td>
            </tr>`;
          })}
        </tbody>
      </table>
      ${entities.length > ITEMS_LIMIT
        ? html`<p class="muted">
            Showing ${ITEMS_LIMIT} of ${entities.length}. Narrow the folder or search to see the rest.
          </p>`
        : nothing}
    `;
  }

  private renderDetails(node: TreeNode) {
    const rows: [string, string | number][] = [];
    const device = node.deviceId ? this.hass.devices[node.deviceId] : undefined;
    if (device) {
      const domain =
        (device.primary_config_entry && this.registry.entryDomains[device.primary_config_entry]) ||
        undefined;
      const via = device.via_device_id ? this.hass.devices[device.via_device_id] : undefined;
      rows.push(
        ["Manufacturer", device.manufacturer ?? "-"],
        ["Model", device.model ?? "-"],
        ["Integration", domain ? (this.registry.integrationNames[domain] ?? domain) : "-"],
        ["Device area", this.deviceAreaName(device.id)],
      );
      if (via) rows.push(["Connected via", via.name_by_user || via.name || via.id]);
    } else if (node.areaId) {
      const area = this.hass.areas[node.areaId];
      const floor = area?.floor_id ? this.hass.floors[area.floor_id] : undefined;
      rows.push(["Floor", floor?.name ?? "No floor"]);
    } else if (node.kind === "integration" && node.domain) {
      rows.push(["Domain", node.domain]);
    } else if (node.kind === "domain" && node.domain) {
      rows.push(["Domain", node.domain]);
    } else {
      rows.push(["Kind", node.kind]);
    }
    rows.push(["Entities", node.entityCount]);
    const path = settingsPath(node);

    return html`
      <table class="kv">
        ${rows.map(
          ([key, value]) => html`<tr>
            <td>${key}</td>
            <td>${value}</td>
          </tr>`,
        )}
      </table>
      ${path
        ? html`<div class="actions">
            <button class="text" @click=${() => navigate(path)}>
              <ha-icon icon="mdi:open-in-new"></ha-icon>Open in Settings
            </button>
          </div>`
        : nothing}
    `;
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--ha-space-4, 16px);
      padding: var(--ha-space-4, 16px);
      overflow: auto;
      --mdc-icon-size: 18px;
    }

    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }

    .card {
      border-radius: var(--ha-card-border-radius, 12px);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
    }

    .hint {
      padding: var(--ha-space-4, 16px);
      color: var(--secondary-text-color);
    }

    .head {
      padding: var(--ha-space-4, 16px) var(--ha-space-4, 16px) 0;
    }

    .body {
      padding: var(--ha-space-4, 16px);
    }

    .crumbs {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px 4px;
      font-size: 13px;
      color: var(--secondary-text-color);
      --mdc-icon-size: 16px;
    }

    .crumbs > ha-icon {
      margin-right: 2px;
    }

    .crumb {
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
    }

    .crumb:hover {
      color: var(--primary-color);
      text-decoration: underline;
    }

    .sep {
      opacity: 0.7;
    }

    .also {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 8px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--secondary-text-color);
    }

    .also:hover {
      color: var(--primary-color);
    }

    .title {
      display: flex;
      align-items: center;
      gap: var(--ha-space-3, 12px);
      margin-top: var(--ha-space-3, 12px);
    }

    .badge {
      flex: none;
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(var(--rgb-state-icon-color, 68, 115, 158), 0.15);
      color: var(--state-icon-color);
      --mdc-icon-size: 24px;
    }

    .badge.active {
      background: rgba(var(--rgb-state-active-color, 255, 152, 0), 0.18);
      color: var(--state-active-color, #ff9800);
    }

    .badge.bad {
      background: var(--secondary-background-color);
      color: var(--disabled-text-color);
    }

    .badge.folder {
      background: var(--secondary-background-color);
      color: var(--secondary-text-color);
    }

    .name {
      min-width: 0;
      flex: 1;
    }

    h2 {
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--ha-font-size-xl, 20px);
      font-weight: var(--ha-font-weight-normal, 400);
    }

    .mono {
      font-family: var(--ha-font-family-code, ui-monospace, monospace);
      font-size: 13px;
      color: var(--secondary-text-color);
    }

    .state {
      flex: none;
      text-align: right;
    }

    .state .value {
      font-size: var(--ha-font-size-2xl, 24px);
    }

    .state .since {
      font-size: 12px;
      color: var(--secondary-text-color);
    }

    .bad {
      color: var(--error-color);
    }

    .banner {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: var(--ha-space-3, 12px);
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(var(--rgb-warning-color, 255, 166, 0), 0.12);
      font-size: 13px;
      color: var(--primary-text-color);
    }

    .banner ha-icon {
      color: var(--warning-color);
    }

    .tabs {
      display: flex;
      gap: 4px;
      margin-top: var(--ha-space-3, 12px);
      overflow-x: auto;
    }

    .tabs button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 44px;
      padding: 0 14px;
      border: 0;
      border-bottom: 2px solid transparent;
      border-radius: 8px 8px 0 0;
      background: none;
      color: var(--secondary-text-color);
      font-weight: 500;
      white-space: nowrap;
    }

    .tabs button:hover {
      color: var(--primary-text-color);
    }

    .tabs button[aria-selected="true"] {
      border-bottom-color: var(--primary-color);
      background: rgba(var(--rgb-primary-color), 0.08);
      color: var(--primary-color);
    }

    h3 {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--secondary-text-color);
    }

    .refs + h3 {
      margin-top: var(--ha-space-5, 20px);
    }

    .muted {
      margin: 0;
      color: var(--secondary-text-color);
      font-size: 14px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    .kv td {
      padding: 9px 4px;
      border-top: 1px solid var(--divider-color);
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    .kv tr:last-child td {
      border-bottom: 1px solid var(--divider-color);
    }

    .kv td:first-child {
      width: 40%;
      color: var(--secondary-text-color);
    }

    .footnote {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: var(--ha-space-3, 12px);
      font-size: 13px;
      color: var(--secondary-text-color);
      --mdc-icon-size: 16px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: var(--ha-space-3, 12px);
    }

    button.text {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 12px;
      border: 0;
      border-radius: 18px;
      background: transparent;
      color: var(--primary-color);
      font-weight: 500;
    }

    button.text:hover:not([disabled]) {
      background: rgba(var(--rgb-primary-color), 0.08);
    }

    button.text[disabled] {
      color: var(--disabled-text-color);
      cursor: default;
    }

    .refs {
      display: flex;
      flex-direction: column;
    }

    .ref {
      display: grid;
      grid-template-columns: 24px 96px 1fr auto;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      padding: 2px 4px;
      border-bottom: 1px solid var(--divider-color);
      font-size: 14px;
      color: var(--secondary-text-color);
    }

    .ref.current {
      background: rgba(var(--rgb-primary-color), 0.06);
    }

    .view-name {
      font-weight: 500;
      color: var(--primary-text-color);
    }

    .ref .path {
      color: var(--primary-text-color);
      overflow-wrap: anywhere;
    }

    .ref .path.muted {
      color: var(--secondary-text-color);
    }

    .used-by {
      display: flex;
      flex-direction: column;
    }

    .used-by button {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 40px;
      padding: 0 4px;
      border: 0;
      border-bottom: 1px solid var(--divider-color);
      background: none;
      text-align: left;
    }

    .used-by button:hover {
      color: var(--primary-color);
    }

    .used-by ha-icon {
      color: var(--secondary-text-color);
    }

    .embedded {
      margin: calc(-1 * var(--ha-space-4, 16px));
    }

    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: var(--ha-space-3, 12px);
      margin-bottom: var(--ha-space-4, 16px);
    }

    .tile {
      padding: 12px 14px;
      border: 1px solid var(--divider-color);
      border-radius: 10px;
    }

    .tile-value {
      font-size: var(--ha-font-size-2xl, 24px);
    }

    .tile-value.active {
      color: var(--state-active-color, #ff9800);
    }

    .tile-value.bad {
      color: var(--error-color);
    }

    .tile-label {
      margin-top: 2px;
      font-size: 13px;
      color: var(--secondary-text-color);
    }

    .items {
      table-layout: fixed;
    }

    .col-name {
      width: 34%;
    }

    .col-id {
      width: 32%;
    }

    .col-state {
      width: 18%;
    }

    .col-area {
      width: 16%;
    }

    .items th {
      padding: 8px 6px;
      border-bottom: 1px solid var(--divider-color);
      text-align: left;
      font-weight: 500;
      font-size: 13px;
      color: var(--secondary-text-color);
    }

    .items th,
    .items td {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .items td {
      padding: 7px 6px;
      border-bottom: 1px solid var(--divider-color);
    }

    .items tbody tr {
      cursor: pointer;
    }

    .items tbody tr:hover {
      background: rgba(var(--rgb-primary-text-color), 0.04);
    }

    .item-name ha-icon {
      margin-right: 8px;
      vertical-align: -3px;
      color: var(--state-icon-color);
    }

    .item-name ha-icon.active {
      color: var(--state-active-color, #ff9800);
    }

    .items + .muted {
      margin-top: var(--ha-space-3, 12px);
    }
  `;
}

define("ee-detail-pane", EntityExplorerDetailPane);

declare global {
  interface HTMLElementTagNameMap {
    "ee-detail-pane": EntityExplorerDetailPane;
  }
}

