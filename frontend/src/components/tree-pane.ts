import {
  virtualize,
  virtualizerRef,
  type VirtualizerHostElement,
} from "@lit-labs/virtualizer/virtualize.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";

import { define } from "../define";
import type { HomeAssistant } from "../hass";
import { domainIcon, entityIcon } from "../icons";
import type { TreeNode, ViewId } from "../tree/model";
import type { SearchResult, TreeRow } from "../tree/rows";
import { VIEWS } from "../views";

export type ChipId = "unavailable" | "hide-diagnostic" | "hide-hidden";

export const CHIPS: { id: ChipId; label: string; icon: string }[] = [
  { id: "unavailable", label: "Unavailable", icon: "mdi:alert-circle-outline" },
  { id: "hide-diagnostic", label: "Hide diagnostic", icon: "mdi:eye-off-outline" },
  { id: "hide-hidden", label: "Hide hidden", icon: "mdi:eye-off" },
];

type Item = { kind: "row"; row: TreeRow } | { kind: "result"; result: SearchResult };

// Presentational: the panel owns all state and listens for these events.
//   ee-view-change   detail: ViewId
//   ee-toggle        detail: node id
//   ee-select        detail: node id
//   ee-query-change  detail: string
//   ee-chip-toggle   detail: ChipId
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
  };

  declare hass: HomeAssistant;
  declare view: ViewId;
  declare rows: TreeRow[];
  // Set while a search is active. The pane then lists results, not the tree.
  declare results?: SearchResult[];
  declare expanded: ReadonlySet<string>;
  declare selectedId?: string;
  declare query: string;
  declare chips: ReadonlySet<ChipId>;
  declare entityTotal: number;

  private scrollToSelected = false;

  revealSelected() {
    this.scrollToSelected = true;
    this.requestUpdate();
  }

  protected async updated(changed: PropertyValues) {
    super.updated(changed);
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
    const empty = this.results
      ? "No matches in this view"
      : this.chips.size
        ? "No items match the filters"
        : "Nothing to show";

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
        <label class="search">
          <ha-icon icon="mdi:magnify"></ha-icon>
          <input
            type="search"
            placeholder="Search ${VIEWS[this.view].name.toLowerCase()} tree"
            aria-label="Search"
            .value=${this.query}
            @input=${(e: InputEvent) =>
              this.emit("ee-query-change", (e.target as HTMLInputElement).value)}
          />
        </label>
        <div class="chips">
          ${CHIPS.map(
            (chip) => html`
              <button
                class="chip"
                aria-pressed=${this.chips.has(chip.id)}
                @click=${() => this.emit("ee-chip-toggle", chip.id)}
              >
                <ha-icon .icon=${chip.icon}></ha-icon>${chip.label}
              </button>
            `,
          )}
        </div>
        <div class="note"><ha-icon icon="mdi:information-outline"></ha-icon>${VIEWS[this.view].note}</div>
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
        <span>${this.entityTotal} entities</span>
        ${this.view === "location"
          ? html`<span class="key"><i></i>area override</span><span>1 of 2 = split device</span>`
          : nothing}
      </div>
    `;
  }

  private renderRow(node: TreeNode, depth: number, path?: string[]) {
    const isFolder = node.children.length > 0;
    const expanded = isFolder && !path && this.expanded.has(node.id);
    const stateObj = node.entityId ? this.hass.states[node.entityId] : undefined;
    const unavailable = stateObj?.state === "unavailable";

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
        style="padding-left: ${4 + depth * 12}px"
        @click=${() => this.emit("ee-select", node.id)}
        @dblclick=${isFolder && !path ? toggle : nothing}
        @keydown=${onKey}
      >
        <span class="chev" @click=${isFolder && !path ? toggle : nothing}>
          ${isFolder && !path ? html`<ha-icon icon="mdi:chevron-right"></ha-icon>` : nothing}
        </span>
        <ha-icon
          class="icon ${node.entityId ? (unavailable ? "bad" : "") : "folder"}"
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
        ${stateObj
          ? html`<span class="state ${unavailable ? "bad" : ""}">${this.hass.formatEntityState(stateObj)}</span>`
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
      background: var(--card-background-color);
      --mdc-icon-size: 16px;
    }

    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
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

    .note {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--secondary-text-color);
      --mdc-icon-size: 15px;
    }

    .tree {
      flex: 1;
      min-height: 0;
      padding: 4px 6px;
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
      height: 28px;
      padding-right: 10px;
      border-radius: 6px;
      font-size: 13.5px;
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
      height: 40px;
    }

    .chev {
      flex: none;
      width: 16px;
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

    .state,
    .count {
      margin-left: auto;
      padding-left: 8px;
      font-size: 12px;
      font-weight: 400;
      color: var(--secondary-text-color);
    }

    .state.bad {
      color: var(--error-color);
    }

    .foot {
      display: flex;
      gap: var(--ha-space-3, 12px);
      align-items: center;
      padding: 8px 12px;
      border-top: 1px solid var(--divider-color);
      font-size: 12px;
      color: var(--secondary-text-color);
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
