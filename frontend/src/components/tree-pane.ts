import {
  virtualize,
  virtualizerRef,
  type VirtualizerHostElement,
} from "@lit-labs/virtualizer/virtualize.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";

import { define } from "../define";
import type { HomeAssistant } from "../hass";
import { domainIcon, entityIcon } from "../icons";
import { isActive, isUnavailable, isUpdateAvailable } from "../state";
import type { TreeNode, ViewId } from "../tree/model";
import type { SearchResult, TreeRow } from "../tree/rows";
import { CHIPS, TREE_SIZES, VIEWS, type ChipId, type TreeSize } from "../views";

type Item = { kind: "row"; row: TreeRow } | { kind: "result"; result: SearchResult };

// Presentational: the panel owns all state and listens for these events.
//   ee-view-change   detail: ViewId
//   ee-toggle        detail: node id
//   ee-select        detail: node id
//   ee-query-change  detail: string
//   ee-chip-toggle   detail: ChipId
//   ee-size-change   detail: TreeSize
//   ee-group-network-change  detail: boolean
//   ee-expand-all, ee-collapse-all
export class EntityExplorerTreePane extends LitElement {
  static properties = {
    hass: { attribute: false },
    view: { attribute: false },
    rows: { attribute: false },
    results: { attribute: false },
    expanded: { attribute: false },
    selectedId: { attribute: false },
    query: { attribute: false },
    chips: { attribute: false },
    entityTotal: { attribute: false },
    entityTotalUnfiltered: { attribute: false },
    size: { reflect: true },
    groupNetwork: { attribute: false },
    popup: { state: true },
  };

  declare hass: HomeAssistant;
  declare view: ViewId;
  declare rows: TreeRow[];
  // Set while a search or the "Unavailable only" filter is on. The pane then
  // lists results with their paths, not the tree.
  declare results?: SearchResult[];
  declare expanded: ReadonlySet<string>;
  declare selectedId?: string;
  declare query: string;
  declare chips: ReadonlySet<ChipId>;
  declare entityTotal: number;
  declare entityTotalUnfiltered: number;
  declare size: TreeSize;
  declare groupNetwork: boolean;
  declare private popup?: "info" | "options";

  constructor() {
    super();
    this.size = "default";
    this.groupNetwork = true;
  }

  private closeMenuOutside = (e: Event) => {
    const anchors = [...this.renderRoot.querySelectorAll(".menu-anchor")];
    if (!anchors.some((a) => e.composedPath().includes(a))) this.popup = undefined;
  };

  private closeMenuOnEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.popup = undefined;
  };

  private togglePopup(popup: "info" | "options") {
    this.popup = this.popup === popup ? undefined : popup;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.popup = undefined;
    this.listenForMenuClose(false);
  }

  private listenForMenuClose(on: boolean) {
    const method = on ? "addEventListener" : "removeEventListener";
    document[method]("pointerdown", this.closeMenuOutside);
    document[method]("keydown", this.closeMenuOnEscape as EventListener);
  }

  private scrollToSelected = false;

  revealSelected() {
    this.scrollToSelected = true;
    this.requestUpdate();
  }

  protected async updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has("popup")) this.listenForMenuClose(Boolean(this.popup));
    if (!this.scrollToSelected) return;
    this.scrollToSelected = false;
    const index = this.items().findIndex(
      (item) => (item.kind === "row" ? item.row.node.id : item.result.node.id) === this.selectedId,
    );
    const virtualizer = (this.renderRoot.querySelector(".tree") as VirtualizerHostElement | null)?.[
      virtualizerRef
    ];
    if (index < 0 || !virtualizer) return;
    // Scrolling before the virtualizer lays out the new items lands on the
    // old list's geometry and does nothing.
    await virtualizer.layoutComplete;
    virtualizer.element(index)?.scrollIntoView({ block: "nearest" });
  }

  private items(): Item[] {
    return this.results
      ? this.results.map((result) => ({ kind: "result", result }))
      : this.rows.map((row) => ({ kind: "row", row }));
  }

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  render() {
    const items = this.items();
    const empty = this.query.trim()
      ? "No matches in this view"
      : this.chips.has("unavailable")
        ? "No unavailable entities in this view"
        : this.chips.size
          ? "No items match the filters"
          : "Nothing to show";
    const filtered = this.entityTotal !== this.entityTotalUnfiltered;

    return html`
      <div class="head">
        <div class="seg" role="group" aria-label="Tree view">
          ${(Object.keys(VIEWS) as ViewId[]).map(
            (id) => html`
              <button
                aria-pressed=${this.view === id}
                title=${VIEWS[id].name}
                @click=${() => this.emit("ee-view-change", id)}
              >
                <ha-icon .icon=${VIEWS[id].icon}></ha-icon><span>${VIEWS[id].name}</span>
              </button>
            `,
          )}
        </div>
        <div class="search-row">
          <label class="search">
            <ha-icon icon="mdi:magnify"></ha-icon>
            <input
              type="search"
              placeholder="Search ${VIEWS[this.view].name.toLowerCase()}"
              aria-label="Search"
              .value=${this.query}
              @input=${(e: InputEvent) =>
                this.emit("ee-query-change", (e.target as HTMLInputElement).value)}
            />
          </label>
          <button
            class="icon"
            title="Expand all"
            aria-label="Expand all"
            ?disabled=${Boolean(this.results)}
            @click=${() => this.emit("ee-expand-all", undefined)}
          >
            <ha-icon icon="mdi:unfold-more-horizontal"></ha-icon>
          </button>
          <button
            class="icon"
            title="Collapse all"
            aria-label="Collapse all"
            ?disabled=${Boolean(this.results)}
            @click=${() => this.emit("ee-collapse-all", undefined)}
          >
            <ha-icon icon="mdi:unfold-less-horizontal"></ha-icon>
          </button>
        </div>
        <div class="chips">
          ${CHIPS.map(
            (chip) => html`
              <button
                class="chip"
                aria-pressed=${this.chips.has(chip.id)}
                @click=${() => this.emit("ee-chip-toggle", chip.id)}
              >
                <ha-icon .icon=${this.chips.has(chip.id) ? "mdi:check" : chip.icon}></ha-icon
                ><span>${chip.label}</span>
              </button>
            `,
          )}
        </div>
      </div>
      ${items.length
        ? // The directive, not the <lit-virtualizer> element: HA's frontend
          // defines that element itself, and two definitions of one tag throw.
          html`<div class="tree" role="tree" aria-label="${VIEWS[this.view].name} tree">
            ${virtualize({
              items,
              scroller: true,
              // The virtualizer can ask for indexes past the end while the
              // list shrinks, for example on a view switch.
              keyFunction: (item: Item | undefined, index: number) =>
                !item
                  ? `missing:${index}`
                  : item.kind === "row"
                    ? item.row.node.id
                    : `result:${item.result.node.id}`,
              renderItem: (item: Item | undefined) =>
                !item
                  ? html``
                  : item.kind === "row"
                    ? this.renderRow(item.row.node, item.row.depth)
                    : this.renderRow(item.result.node, 0, item.result.path),
            })}
          </div>`
        : html`<div class="empty">${empty}</div>`}
      <div class="foot">
        <span
          >${filtered ? `${this.entityTotal} of ${this.entityTotalUnfiltered}` : this.entityTotal}
          entities</span
        >
        <div class="menu-anchor">
          <button
            class="icon small"
            title="About this view"
            aria-label="About this view"
            aria-expanded=${String(this.popup === "info")}
            @click=${() => this.togglePopup("info")}
          >
            <ha-icon icon="mdi:information-outline"></ha-icon>
          </button>
          ${this.popup === "info"
            ? html`<div class="menu info" role="dialog" aria-label="About this view">
                <div class="menu-title">${VIEWS[this.view].name} view</div>
                <p>
                  ${this.view === "network" && this.groupNetwork ? "Integration type > " : ""}${VIEWS[
                    this.view
                  ].note}
                </p>
                ${this.view === "location"
                  ? html`<p class="key"><i></i>Area set on the entity, overriding its device</p>
                      <p><span class="tag">1 of 2</span> Device split across areas</p>`
                  : nothing}
              </div>`
            : nothing}
        </div>
        <div class="menu-anchor">
          <button
            class="icon small"
            title="Tree options"
            aria-label="Tree options"
            aria-haspopup="menu"
            aria-expanded=${String(this.popup === "options")}
            @click=${() => this.togglePopup("options")}
          >
            <ha-icon icon="mdi:dots-horizontal"></ha-icon>
          </button>
          ${this.popup === "options"
            ? html`<div class="menu" role="menu" aria-label="Tree options">
                <div class="menu-title">Tree size</div>
                ${TREE_SIZES.map(
                  (size) => html`<button
                    role="menuitemradio"
                    aria-checked=${String(this.size === size.id)}
                    @click=${() => this.emit("ee-size-change", size.id)}
                  >
                    <ha-icon .icon=${this.size === size.id ? "mdi:check" : ""}></ha-icon
                    >${size.label}
                  </button>`,
                )}
                ${this.view === "network"
                  ? html`<div class="menu-title">Network</div>
                      <button
                        role="menuitemcheckbox"
                        aria-checked=${String(this.groupNetwork)}
                        @click=${() => this.emit("ee-group-network-change", !this.groupNetwork)}
                      >
                        <ha-icon .icon=${this.groupNetwork ? "mdi:check" : ""}></ha-icon>Group by
                        integration type
                      </button>`
                  : nothing}
              </div>`
            : nothing}
        </div>
      </div>
    `;
  }

  private renderRow(node: TreeNode, depth: number, path?: string[]) {
    const isFolder = node.children.length > 0;
    const expanded = isFolder && !path && this.expanded.has(node.id);
    const stateObj = node.entityId ? this.hass.states[node.entityId] : undefined;
    const unavailable = isUnavailable(stateObj);
    // Rows carry no state text; it lives in the detail pane and the tooltip.
    // Only states worth noticing while scanning get an icon.
    const stateText = stateObj ? this.hass.formatEntityState(stateObj) : undefined;
    const updateAvailable = isUpdateAvailable(stateObj);

    const toggle = (e: Event) => {
      e.stopPropagation();
      this.emit("ee-toggle", node.id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.emit("ee-select", node.id);
      } else if (
        isFolder &&
        !path &&
        ((e.key === "ArrowRight" && !expanded) || (e.key === "ArrowLeft" && expanded))
      ) {
        toggle(e);
      }
    };

    return html`
      <div
        class="row ${path ? "result" : ""} ${node.muted ? "muted" : ""}"
        role="treeitem"
        tabindex="0"
        aria-level=${depth + 1}
        aria-expanded=${isFolder && !path ? String(expanded) : nothing}
        aria-selected=${String(this.selectedId === node.id)}
        style="--depth: ${depth}"
        title=${stateText ? `${node.label}: ${stateText}` : nothing}
        @click=${() => this.emit("ee-select", node.id)}
        @dblclick=${isFolder && !path ? toggle : nothing}
        @keydown=${onKey}
      >
        <span class="chev" @click=${isFolder && !path ? toggle : nothing}>
          ${isFolder && !path ? html`<ha-icon icon="mdi:chevron-right"></ha-icon>` : nothing}
        </span>
        <ha-icon
          class="icon ${node.entityId
            ? unavailable
              ? "bad"
              : isActive(stateObj)
                ? "active"
                : ""
            : "folder"}"
          .icon=${node.entityId ? entityIcon(this.hass, node.entityId) : (node.icon ?? folderIcon(node))}
        ></ha-icon>
        <span class="label">
          ${node.label}
          ${path ? html`<span class="path">${path.join(" > ")}</span>` : nothing}
        </span>
        ${node.partial
          ? html`<span class="tag" title="This device lives in another area. Only some of its entities resolve here."
              >${node.partial}</span
            >`
          : nothing}
        ${node.override
          ? html`<span class="override" title="Area set on the entity. It overrides the device area."></span>`
          : nothing}
        ${unavailable
          ? html`<ha-icon class="status bad" icon="mdi:alert-circle-outline"></ha-icon>`
          : updateAvailable
            ? html`<ha-icon class="status update" icon="mdi:arrow-up-circle"></ha-icon>`
            : isFolder
              ? html`<span class="count">${node.entityCount}</span>`
              : nothing}
      </div>
    `;
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      container-type: inline-size;
      background: var(--card-background-color);
      --mdc-icon-size: 16px;
      --row-height: 36px;
      --row-font-size: 14px;
      --row-icon-size: 20px;
      --row-indent: 16px;
    }

    :host([size="compact"]) {
      --row-height: 28px;
      --row-font-size: 13.5px;
      --row-icon-size: 16px;
      --row-indent: 12px;
    }

    :host([size="large"]) {
      --row-height: 44px;
      --row-font-size: 15px;
      --row-icon-size: 24px;
      --row-indent: 20px;
    }

    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }

    /* ha-icon is inline by default and sits off center in a flex row. */
    .seg ha-icon,
    .search ha-icon,
    .chip ha-icon,
    button.icon ha-icon {
      display: flex;
      flex: none;
    }

    .search-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .search-row .search {
      flex: 1;
      min-width: 0;
    }

    button.icon {
      flex: none;
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--secondary-text-color);
      --mdc-icon-size: 20px;
    }

    button.icon:hover:not([disabled]) {
      background: rgba(var(--rgb-primary-text-color), 0.06);
      color: var(--primary-text-color);
    }

    button.icon[disabled] {
      color: var(--disabled-text-color);
      cursor: default;
    }

    /* A narrow tree keeps the view switcher on one line by dropping labels;
       each button keeps its name as a tooltip. */
    @container (max-width: 380px) {
      .seg button span {
        display: none;
      }
    }

    .head {
      display: flex;
      flex-direction: column;
      gap: var(--ha-space-2, 8px);
      padding: var(--ha-space-3, 12px);
      border-bottom: 1px solid var(--divider-color);
    }

    .seg {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      overflow: hidden;
    }

    .seg button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 32px;
      border: 0;
      border-right: 1px solid var(--divider-color);
      background: transparent;
      font-size: 13px;
    }

    .seg button:last-child {
      border-right: 0;
    }

    .seg button[aria-pressed="true"] {
      background: rgba(var(--rgb-primary-color), 0.12);
      color: var(--primary-color);
      font-weight: 500;
    }

    .search {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 36px;
      padding: 0 12px;
      border-radius: 18px;
      background: var(--secondary-background-color);
      color: var(--secondary-text-color);
    }

    .search input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      font: inherit;
      color: var(--primary-text-color);
      outline: none;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 28px;
      padding: 0 10px;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      background: transparent;
      font-size: 12.5px;
      white-space: nowrap;
      --mdc-icon-size: 15px;
    }

    .chip[aria-pressed="true"] {
      background: rgba(var(--rgb-primary-color), 0.12);
      border-color: transparent;
      color: var(--primary-color);
    }

    .tree {
      flex: 1;
      min-height: 0;
      padding: 4px 6px;
      --mdc-icon-size: var(--row-icon-size);
    }

    .empty {
      flex: 1;
      padding: var(--ha-space-4, 16px);
      color: var(--secondary-text-color);
    }

    /* The virtualizer positions rows absolutely, so the scroller's padding
       does not shrink them. The width leaves the same gap on both sides. */
    .row {
      display: flex;
      align-items: center;
      gap: 4px;
      width: calc(100% - 12px);
      box-sizing: border-box;
      height: var(--row-height);
      padding-left: calc(4px + var(--depth, 0) * var(--row-indent));
      padding-right: 10px;
      border-radius: 6px;
      font-size: var(--row-font-size);
      white-space: nowrap;
      cursor: pointer;
      outline: none;
    }

    .row:hover {
      background: rgba(var(--rgb-primary-text-color), 0.04);
    }

    .row:focus-visible {
      box-shadow: inset 0 0 0 2px var(--primary-color);
    }

    .row[aria-selected="true"] {
      background: rgba(var(--rgb-primary-color), 0.12);
      color: var(--primary-color);
      font-weight: 500;
    }

    .row.result {
      height: calc(var(--row-height) + 12px);
    }

    .chev {
      flex: none;
      width: var(--row-icon-size);
      display: grid;
      place-items: center;
      color: var(--secondary-text-color);
    }

    .chev ha-icon {
      transition: transform 0.15s;
    }

    .row[aria-expanded="true"] .chev ha-icon {
      transform: rotate(90deg);
    }

    .icon {
      flex: none;
      margin-right: 2px;
      color: var(--state-icon-color);
    }

    .icon.folder {
      color: var(--secondary-text-color);
    }

    .icon.bad {
      color: var(--disabled-text-color);
    }

    .icon.active {
      color: var(--state-active-color, #ff9800);
    }

    .status {
      flex: none;
      display: flex;
      margin-left: auto;
      padding-left: 8px;
    }

    .status.bad {
      color: var(--error-color);
    }

    .status.update {
      color: var(--state-update-on-color, var(--primary-color));
    }

    .label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .path {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 11px;
      font-weight: 400;
      color: var(--secondary-text-color);
    }

    .row.muted .label,
    .row.muted .icon {
      opacity: 0.55;
    }

    .tag {
      flex: none;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--secondary-background-color);
      font-size: 10.5px;
      font-weight: 500;
      color: var(--secondary-text-color);
    }

    .override,
    .key i {
      flex: none;
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--warning-color);
    }

    .count {
      margin-left: auto;
      padding-left: 8px;
      font-size: calc(var(--row-font-size) - 1.5px);
      font-weight: 400;
      color: var(--secondary-text-color);
    }

    .foot {
      display: flex;
      gap: 4px;
      align-items: center;
      padding: 8px 12px;
      border-top: 1px solid var(--divider-color);
      font-size: 12px;
      color: var(--secondary-text-color);
    }

    .menu-anchor {
      position: relative;
    }

    .foot > span:first-child {
      margin-right: auto;
    }

    .menu.info {
      width: max-content;
      max-width: 260px;
      padding: 6px 16px 10px;
      font-size: 13px;
      color: var(--primary-text-color);
    }

    .menu.info .menu-title {
      padding: 6px 0;
    }

    .menu.info p {
      margin: 4px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    button.icon.small {
      width: 28px;
      height: 28px;
      margin: -4px -4px -4px 0;
    }

    .menu {
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      z-index: 2;
      display: flex;
      flex-direction: column;
      min-width: 160px;
      padding: 6px 0;
      border-radius: 12px;
      background: var(--card-background-color);
      box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0, 0, 0, 0.24));
      border: 1px solid var(--divider-color);
      --mdc-icon-size: 18px;
    }

    .menu-title {
      padding: 6px 16px;
      font-size: 12px;
      font-weight: 500;
      color: var(--secondary-text-color);
    }

    .menu button {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 36px;
      padding: 0 16px;
      border: 0;
      background: none;
      font-size: 14px;
      text-align: left;
      white-space: nowrap;
    }

    .menu button ha-icon {
      display: flex;
      width: 18px;
      color: var(--primary-color);
    }

    .menu button:hover {
      background: rgba(var(--rgb-primary-text-color), 0.06);
    }

    .key {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
  `;
}

function folderIcon(node: TreeNode): string {
  switch (node.kind) {
    case "device":
      return "mdi:devices";
    case "area":
      return "mdi:texture-box";
    case "domain":
      return domainIcon(node.domain ?? "");
    default:
      return "mdi:folder-outline";
  }
}

define("ee-tree-pane", EntityExplorerTreePane);

declare global {
  interface HTMLElementTagNameMap {
    "ee-tree-pane": EntityExplorerTreePane;
  }
}
