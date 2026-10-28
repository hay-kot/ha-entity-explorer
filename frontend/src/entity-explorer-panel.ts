import "./components/detail-pane";
import "./components/tree-pane";

import { LitElement, css, html, nothing, type PropertyValues } from "lit";

import type { ViewReference } from "./components/detail-pane";
import type { EntityExplorerTreePane } from "./components/tree-pane";
import {
  EMPTY_EXTRAS,
  RegistryCache,
  fetchEntryDomains,
  fetchIntegrationNames,
  fetchLabels,
  referencedDomains,
  type RegistryExtras,
} from "./data/registry";
import { define } from "./define";
import { loadExpanded, loadTreeWidth, saveExpanded, saveTreeWidth } from "./persist";
import type { HomeAssistant, PanelInfo } from "./hass";
import { buildView } from "./tree/build";
import { VIEW_IDS, type Registry, type TreeNode, type ViewId } from "./tree/model";
import {
  distinctEntityCount,
  filterTree,
  findEntity,
  findEntityAll,
  findNode,
  searchTree,
  visibleRows,
} from "./tree/rows";
import { readUrlState, urlFor } from "./url";
import type { ChipId } from "./views";

interface Selection {
  id: string;
  entityId?: string;
}

const TREE_WIDTH_DEFAULT = 400;
const TREE_WIDTH_MIN = 260;
// Room the detail pane keeps when the tree is dragged wider.
const DETAIL_WIDTH_MIN = 360;

function storedTreeWidth(): number {
  const width = loadTreeWidth();
  return width && width >= TREE_WIDTH_MIN ? width : TREE_WIDTH_DEFAULT;
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
    treeWidth: { state: true },
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
  declare private treeWidth: number;

  private registryCache = new RegistryCache();
  private trees = new Map<ViewId, TreeNode[]>();
  private treesRegistry?: Registry;
  private requestedDomains = new Set<string>();
  private loading = false;
  private referencesCache?: { registry: Registry; entityId: string; value: ViewReference[] };
  private unsubscribeLabels?: Promise<() => void>;
  private labelsLoaded = false;
  private integrationsLoaded = false;
  private urlRead = false;
  // A selection from the URL waits here until the tree that holds it is
  // built. The Labels and Network views need fetched data first.
  private pendingSelection?: { entity?: string; node?: string };

  constructor() {
    super();
    this.narrow = false;
    this.view = "location";
    this.expanded = new Map();
    this.collapsedWhileFiltering = new Set();
    this.query = "";
    this.chips = new Set();
    this.extras = EMPTY_EXTRAS;
    this.treeWidth = storedTreeWidth();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribeLabels?.then((unsubscribe) => unsubscribe());
    this.unsubscribeLabels = undefined;
  }

  protected willUpdate(changed: PropertyValues) {
    super.willUpdate(changed);
    if (!this.hass) return;
    if (!this.urlRead) this.readUrl();
    if (changed.has("hass")) this.watchRegistries(changed.get("hass") as HomeAssistant | undefined);
    if (this.pendingSelection) this.applyPendingSelection();
  }

  protected updated(changed: PropertyValues) {
    super.updated(changed);
    if (this.urlRead) this.writeUrl();
  }

  private get basePath(): string {
    return `/${this.panel?.url_path ?? "entity-explorer"}`;
  }

  private readUrl() {
    this.urlRead = true;
    const state = readUrlState(this.basePath, location);
    if (state.view) this.view = state.view;
    this.query = state.query ?? "";
    this.chips = new Set(state.chips);
    if (state.entity || state.node) {
      this.pendingSelection = { entity: state.entity, node: state.node };
    }
  }

  // replaceState, not pushState: tree clicks should not fill the back button
  // history.
  private writeUrl() {
    if (!location.pathname.startsWith(this.basePath)) return;
    const url = urlFor(this.basePath, {
      view: this.view,
      ...(this.pendingSelection ?? this.selectionForUrl()),
      query: this.query,
      chips: [...this.chips],
    });
    if (url !== location.pathname + location.search) history.replaceState(history.state, "", url);
  }

  // An entity id is shorter and survives tree changes, so it is preferred
  // whenever it leads back to the same node.
  private selectionForUrl(): { entity?: string; node?: string } {
    const selection = this.selection;
    if (!selection) return {};
    if (!selection.entityId) return { node: selection.id };
    const first = findEntity(this.roots(this.view), selection.entityId);
    return first?.node.id === selection.id ? { entity: selection.entityId } : { node: selection.id };
  }

  private applyPendingSelection() {
    const { entity, node } = this.pendingSelection!;
    const roots = this.roots(this.view);
    const hit = node ? findNode(roots, node) : entity ? findEntity(roots, entity) : undefined;
    if (!hit) {
      if (this.labelsLoaded && this.integrationsLoaded) this.pendingSelection = undefined;
      return;
    }
    this.pendingSelection = undefined;
    this.selection = { id: hit.node.id, entityId: hit.node.entityId };
    this.setExpanded(
      hit.ancestors.map((n) => n.id),
      true,
    );
    this.revealInTree();
  }

  private watchRegistries(previous: HomeAssistant | undefined) {
    if (!this.hass) return;

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
    } finally {
      this.labelsLoaded = true;
      this.requestUpdate();
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
      this.integrationsLoaded = true;
      this.requestUpdate();
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
    let set = this.expanded.get(view);
    if (!set) {
      set = loadExpanded(view);
      // Cached in place: the stored set equals what is already on screen, so
      // no update is needed.
      if (set) this.expanded.set(view, set);
    }
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
    saveExpanded(this.view, next);
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
    this.showInView(e.detail);
  }

  private onReveal(e: CustomEvent<{ view: ViewId; nodeId: string }>) {
    this.query = "";
    this.showInView(e.detail.view, e.detail.nodeId);
  }

  // Switches to `view` and selects `nodeId`, or the selected entity's node in
  // that view. A selected folder has no counterpart, so the selection clears.
  private showInView(view: ViewId, nodeId?: string) {
    this.view = view;
    const roots = this.roots(view);
    const entityId = this.selection?.entityId;
    const hit = nodeId
      ? findNode(roots, nodeId)
      : entityId
        ? findEntity(roots, entityId)
        : undefined;
    if (!hit) {
      this.selection = undefined;
      return;
    }
    this.selection = { id: hit.node.id, entityId: hit.node.entityId };
    this.setExpanded(
      hit.ancestors.map((n) => n.id),
      true,
    );
    this.revealInTree();
  }

  private revealInTree() {
    this.updateComplete.then(() =>
      this.renderRoot.querySelector<EntityExplorerTreePane>("ee-tree-pane")?.revealSelected(),
    );
  }

  private references(entityId: string): ViewReference[] {
    const registry = this.treesRegistry!;
    const cached = this.referencesCache;
    if (cached?.registry === registry && cached.entityId === entityId) return cached.value;
    const value = VIEW_IDS.map((view) => ({ view, hits: findEntityAll(this.roots(view), entityId) }));
    this.referencesCache = { registry, entityId, value };
    return value;
  }

  private clampTreeWidth(width: number): number {
    const max = Math.max(TREE_WIDTH_MIN, this.clientWidth - DETAIL_WIDTH_MIN);
    return Math.round(Math.min(Math.max(width, TREE_WIDTH_MIN), max));
  }

  private persistTreeWidth() {
    saveTreeWidth(this.treeWidth);
  }

  private onSplitterDown(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startWidth = this.treeWidth;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      this.treeWidth = this.clampTreeWidth(startWidth + ev.clientX - startX);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      this.persistTreeWidth();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    e.preventDefault();
  }

  private onSplitterKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") this.treeWidth = this.clampTreeWidth(this.treeWidth - step);
    else if (e.key === "ArrowRight") this.treeWidth = this.clampTreeWidth(this.treeWidth + step);
    else return;
    e.preventDefault();
    this.persistTreeWidth();
  }

  private resetTreeWidth() {
    this.treeWidth = this.clampTreeWidth(TREE_WIDTH_DEFAULT);
    this.persistTreeWidth();
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
      <div class="body" style="--tree-width: ${this.treeWidth}px">
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
        ${this.narrow
          ? nothing
          : html`<div
              class="splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize tree"
              aria-valuenow=${this.treeWidth}
              aria-valuemin=${TREE_WIDTH_MIN}
              tabindex="0"
              title="Drag to resize. Double-click to reset."
              @pointerdown=${this.onSplitterDown}
              @keydown=${this.onSplitterKey}
              @dblclick=${this.resetTreeWidth}
            ></div>`}
        <ee-detail-pane
          .hass=${this.hass}
          .registry=${this.treesRegistry}
          .view=${this.view}
          .node=${selected?.node}
          .ancestors=${selected?.ancestors ?? []}
          .references=${this.selection?.entityId ? this.references(this.selection.entityId) : []}
          @ee-select=${(e: CustomEvent<string>) => {
            this.onSelect(e);
            this.revealInTree();
          }}
          @ee-reveal=${this.onReveal}
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
      grid-template-columns: var(--tree-width) 9px minmax(0, 1fr);
    }

    :host([narrow]) .body {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) auto;
    }

    ee-tree-pane {
      min-width: 0;
    }

    /* A 9px hit area with a 1px line in the middle, like a pane border. */
    .splitter {
      position: relative;
      margin: 0 -4px 0 -4px;
      width: 9px;
      cursor: col-resize;
      touch-action: none;
      z-index: 1;
      outline: none;
    }

    .splitter::after {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: 4px;
      width: 1px;
      background: var(--divider-color);
      transition:
        background-color 0.15s,
        width 0.15s,
        left 0.15s;
    }

    .splitter:hover::after,
    .splitter:focus-visible::after {
      left: 3px;
      width: 3px;
      background: var(--primary-color);
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

define("entity-explorer-panel", EntityExplorerPanel);

declare global {
  interface HTMLElementTagNameMap {
    "entity-explorer-panel": EntityExplorerPanel;
  }
}
