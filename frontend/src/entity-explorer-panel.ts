import "./components/detail-pane";
import "./components/tree-pane";

import { LitElement, css, html, nothing, type PropertyValues } from "lit";

import type { ChipId, EntityExplorerTreePane } from "./components/tree-pane";
import {
  EMPTY_EXTRAS,
  RegistryCache,
  fetchEntryDomains,
  fetchIntegrationNames,
  fetchLabels,
  referencedDomains,
  type RegistryExtras,
} from "./data/registry";
import type { HomeAssistant, PanelInfo } from "./hass";
import { buildView } from "./tree/build";
import type { Registry, TreeNode, ViewId } from "./tree/model";
import {
  distinctEntityCount,
  filterTree,
  findEntity,
  findNode,
  searchTree,
  visibleRows,
} from "./tree/rows";

interface Selection {
  id: string;
  entityId?: string;
}

export class EntityExplorerPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean, reflect: true },
    panel: { attribute: false },
    view: { state: true },
    expanded: { state: true },
    collapsedWhileFiltering: { state: true },
    selection: { state: true },
    query: { state: true },
    chips: { state: true },
    extras: { state: true },
  };

  declare hass?: HomeAssistant;
  declare narrow: boolean;
  declare panel?: PanelInfo;

  declare private view: ViewId;
  declare private expanded: Map<ViewId, ReadonlySet<string>>;
  // While a filter is on, every folder starts open so matches are visible.
  // This set tracks the folders the user closed since the filter changed.
  declare private collapsedWhileFiltering: ReadonlySet<string>;
  declare private selection?: Selection;
  declare private query: string;
  declare private chips: ReadonlySet<ChipId>;
  declare private extras: RegistryExtras;

  private registryCache = new RegistryCache();
  private trees = new Map<ViewId, TreeNode[]>();
  private treesRegistry?: Registry;
  private requestedDomains = new Set<string>();
  private loading = false;
  private unsubscribeLabels?: Promise<() => void>;

  constructor() {
    super();
    this.narrow = false;
    this.view = "location";
    this.expanded = new Map();
    this.collapsedWhileFiltering = new Set();
    this.query = "";
    this.chips = new Set();
    this.extras = EMPTY_EXTRAS;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribeLabels?.then((unsubscribe) => unsubscribe());
    this.unsubscribeLabels = undefined;
  }

  protected willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    if (!changed.has("hass") || !this.hass) return;
    const previous = changed.get("hass") as HomeAssistant | undefined;

    if (!this.unsubscribeLabels) {
      this.unsubscribeLabels = this.hass.connection.subscribeEvents(
        () => this.loadLabels(),
        "label_registry_updated",
      );
      this.loadLabels();
    }
    if (!previous || previous.devices !== this.hass.devices || previous.entities !== this.hass.entities) {
      this.loadIntegrations();
    }
  }

  private async loadLabels() {
    if (!this.hass) return;
    try {
      this.extras = { ...this.extras, labels: await fetchLabels(this.hass) };
    } catch (err) {
      console.warn("entity-explorer: could not load labels", err);
    }
  }

  // Fetches config entries when a device references one the panel has not
  // seen, then names for any domain not asked for yet.
  private async loadIntegrations() {
    const hass = this.hass;
    if (!hass || this.loading) return;
    this.loading = true;
    try {
      let entryDomains = this.extras.entryDomains;
      const unknownEntry = Object.values(hass.devices).some(
        (d) => d.primary_config_entry && !(d.primary_config_entry in entryDomains),
      );
      if (unknownEntry || !Object.keys(entryDomains).length) {
        entryDomains = await fetchEntryDomains(hass);
      }
      const missing = [...referencedDomains(hass, entryDomains)].filter(
        (d) => !this.requestedDomains.has(d),
      );
      missing.forEach((d) => this.requestedDomains.add(d));
      const names = await fetchIntegrationNames(hass, missing);
      if (entryDomains !== this.extras.entryDomains || Object.keys(names).length) {
        this.extras = {
          ...this.extras,
          entryDomains,
          integrationNames: { ...this.extras.integrationNames, ...names },
        };
      }
    } catch (err) {
      console.warn("entity-explorer: could not load integrations", err);
    } finally {
      this.loading = false;
    }
  }

  private roots(view: ViewId): TreeNode[] {
    const registry = this.registryCache.get(this.hass!, this.extras);
    if (registry !== this.treesRegistry) {
      this.trees.clear();
      this.treesRegistry = registry;
    }
    let roots = this.trees.get(view);
    if (!roots) {
      roots = buildView(view, registry);
      this.trees.set(view, roots);
    }
    return roots;
  }

  private keep = (entityId: string): boolean => {
    const entry = this.treesRegistry?.entities[entityId];
    if (this.chips.has("unavailable") && this.hass?.states[entityId]?.state !== "unavailable") {
      return false;
    }
    if (this.chips.has("hide-diagnostic") && entry?.entity_category) return false;
    if (this.chips.has("hide-hidden") && entry?.hidden) return false;
    return true;
  };

  private expandedFor(view: ViewId, roots: TreeNode[]): ReadonlySet<string> {
    const set = this.expanded.get(view);
    if (set) return set;
    // Floors are few and the areas under them are the useful first level.
    return view === "location" ? new Set(roots.map((n) => n.id)) : new Set();
  }

  private setExpanded(ids: Iterable<string>, open: boolean) {
    const roots = this.roots(this.view);
    const next = new Set(this.expandedFor(this.view, roots));
    for (const id of ids) {
      if (open) next.add(id);
      else next.delete(id);
    }
    this.expanded = new Map(this.expanded).set(this.view, next);
  }

  private onToggle(e: CustomEvent<string>) {
    const id = e.detail;
    if (this.chips.size) {
      const next = new Set(this.collapsedWhileFiltering);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      this.collapsedWhileFiltering = next;
      return;
    }
    const roots = this.roots(this.view);
    this.setExpanded([id], !this.expandedFor(this.view, roots).has(id));
  }

  private onSelect(e: CustomEvent<string>) {
    const hit = findNode(this.roots(this.view), e.detail);
    if (!hit) return;
    this.selection = { id: hit.node.id, entityId: hit.node.entityId };
    // Opening a folder on click and opening a search hit's ancestors keeps the
    // selection visible once the search is cleared.
    const open = hit.ancestors.map((n) => n.id);
    if (hit.node.children.length) open.push(hit.node.id);
    this.setExpanded(open, true);
  }

  private onViewChange(e: CustomEvent<ViewId>) {
    this.view = e.detail;
    const entityId = this.selection?.entityId;
    if (!entityId) {
      this.selection = undefined;
      return;
    }
    const hit = findEntity(this.roots(this.view), entityId);
    if (!hit) {
      this.selection = undefined;
      return;
    }
    this.selection = { id: hit.node.id, entityId };
    this.setExpanded(
      hit.ancestors.map((n) => n.id),
      true,
    );
    this.updateComplete.then(() =>
      this.renderRoot.querySelector<EntityExplorerTreePane>("ee-tree-pane")?.revealSelected(),
    );
  }

  private onChipToggle(e: CustomEvent<ChipId>) {
    const next = new Set(this.chips);
    if (next.has(e.detail)) next.delete(e.detail);
    else next.add(e.detail);
    this.chips = next;
    this.collapsedWhileFiltering = new Set();
  }

  private toggleMenu() {
    this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true }));
  }

  render() {
    if (!this.hass) return nothing;

    const roots = this.roots(this.view);
    const filtering = this.chips.size > 0;
    const tree = filtering ? filterTree(roots, this.keep) : roots;
    const expanded = filtering ? openFolders(tree, this.collapsedWhileFiltering) : this.expandedFor(this.view, roots);
    const results = this.query.trim() ? searchTree(tree, this.query) : undefined;
    const selected = this.selection ? findNode(roots, this.selection.id) : undefined;

    return html`
      <div class="toolbar">
        ${this.narrow
          ? html`<button class="menu" aria-label="Open sidebar" @click=${this.toggleMenu}>
              <ha-icon icon="mdi:menu"></ha-icon>
            </button>`
          : nothing}
        <h1>${this.panel?.title ?? "Entity Explorer"}</h1>
      </div>
      <div class="body">
        <ee-tree-pane
          .hass=${this.hass}
          .view=${this.view}
          .rows=${results ? [] : visibleRows(tree, expanded)}
          .results=${results}
          .expanded=${expanded}
          .selectedId=${this.selection?.id}
          .query=${this.query}
          .chips=${this.chips}
          .entityTotal=${distinctEntityCount(tree)}
          @ee-view-change=${this.onViewChange}
          @ee-toggle=${this.onToggle}
          @ee-select=${this.onSelect}
          @ee-query-change=${(e: CustomEvent<string>) => (this.query = e.detail)}
          @ee-chip-toggle=${this.onChipToggle}
        ></ee-tree-pane>
        <ee-detail-pane
          .hass=${this.hass}
          .node=${selected?.node}
          .ancestors=${selected?.ancestors ?? []}
        ></ee-detail-pane>
      </div>
    `;
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      /* HA's custom panel wrapper has no set height, so 100% resolves to the
         content height and the tree would not scroll. */
      height: 100dvh;
      background: var(--primary-background-color);
      color: var(--primary-text-color);
      font-family: var(--ha-font-family-body, Roboto, sans-serif);
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: var(--ha-space-2, 8px);
      height: var(--header-height, 56px);
      padding: 0 var(--ha-space-4, 16px);
      box-sizing: border-box;
      border-bottom: 1px solid var(--divider-color);
      background: var(--app-header-background-color, var(--primary-background-color));
      color: var(--app-header-text-color, var(--primary-text-color));
    }

    h1 {
      margin: 0;
      font-size: var(--ha-font-size-xl, 20px);
      font-weight: var(--ha-font-weight-normal, 400);
    }

    .menu {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      margin-left: -8px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }

    .body {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(300px, 400px) 1fr;
    }

    :host([narrow]) .body {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) auto;
    }
  `;
}

function openFolders(roots: TreeNode[], closed: ReadonlySet<string>): ReadonlySet<string> {
  const open = new Set<string>();
  const visit = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (!node.children.length) continue;
      if (!closed.has(node.id)) open.add(node.id);
      visit(node.children);
    }
  };
  visit(roots);
  return open;
}

customElements.define("entity-explorer-panel", EntityExplorerPanel);

declare global {
  interface HTMLElementTagNameMap {
    "entity-explorer-panel": EntityExplorerPanel;
  }
}
