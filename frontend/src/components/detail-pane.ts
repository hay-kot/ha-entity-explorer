import { LitElement, css, html, nothing } from "lit";

import type { HomeAssistant } from "../hass";
import { entityIcon } from "../icons";
import type { TreeNode } from "../tree/model";

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

export class EntityExplorerDetailPane extends LitElement {
  static properties = {
    hass: { attribute: false },
    node: { attribute: false },
    ancestors: { attribute: false },
  };

  declare hass: HomeAssistant;
  declare node?: TreeNode;
  declare ancestors: TreeNode[];

  render() {
    const node = this.node;
    if (!node) return html`<div class="card hint">Select an item in the tree.</div>`;

    return html`
      <div class="card">
        <div class="crumbs">${this.ancestors.map((a) => a.label).join(" > ") || " "}</div>
        ${node.entityId ? this.renderEntity(node, node.entityId) : this.renderFolder(node)}
      </div>
    `;
  }

  private renderEntity(node: TreeNode, entityId: string) {
    const stateObj = this.hass.states[entityId];
    const entry = this.hass.entities[entityId];
    const device = entry?.device_id ? this.hass.devices[entry.device_id] : undefined;
    const openMoreInfo = () =>
      this.dispatchEvent(
        new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }),
      );

    return html`
      <div class="title">
        <ha-icon .icon=${entityIcon(this.hass, entityId)}></ha-icon>
        <div>
          <h2>${node.label}</h2>
          <div class="sub">${entityId}</div>
        </div>
      </div>
      <dl>
        <dt>State</dt>
        <dd>${stateObj ? this.hass.formatEntityState(stateObj) : "No state"}</dd>
        ${device
          ? html`<dt>Device</dt>
              <dd>${device.name_by_user || device.name}</dd>`
          : nothing}
        ${entry?.entity_category
          ? html`<dt>Category</dt>
              <dd>${entry.entity_category}</dd>`
          : nothing}
        ${entry?.hidden
          ? html`<dt>Hidden</dt>
              <dd>yes</dd>`
          : nothing}
      </dl>
      <div class="actions">
        <button @click=${openMoreInfo}>
          <ha-icon icon="mdi:information-outline"></ha-icon>More info
        </button>
      </div>
    `;
  }

  private renderFolder(node: TreeNode) {
    const path = settingsPath(node);
    const device = node.deviceId ? this.hass.devices[node.deviceId] : undefined;
    return html`
      <div class="title">
        <ha-icon .icon=${node.icon ?? "mdi:folder-outline"}></ha-icon>
        <div>
          <h2>${node.label}</h2>
          <div class="sub">
            ${device ? [device.manufacturer, device.model].filter(Boolean).join(" ") || "Device" : node.kind}
          </div>
        </div>
      </div>
      ${node.partial
        ? html`<div class="banner">
            This device lives in another area. Only ${node.partial} of its entities resolve here.
          </div>`
        : nothing}
      <dl>
        <dt>Entities</dt>
        <dd>${node.entityCount}</dd>
      </dl>
      ${path
        ? html`<div class="actions">
            <button @click=${() => navigate(path)}>
              <ha-icon icon="mdi:open-in-new"></ha-icon>Open in Settings
            </button>
          </div>`
        : nothing}
    `;
  }

  static styles = css`
    :host {
      display: block;
      padding: var(--ha-space-4, 16px);
      overflow: auto;
    }

    .card {
      padding: var(--ha-space-4, 16px);
      border-radius: var(--ha-card-border-radius, 12px);
      border: 1px solid var(--divider-color);
      background: var(--card-background-color);
    }

    .hint {
      color: var(--secondary-text-color);
    }

    .crumbs {
      font-size: 12px;
      color: var(--secondary-text-color);
      margin-bottom: var(--ha-space-3, 12px);
    }

    .title {
      display: flex;
      align-items: center;
      gap: var(--ha-space-3, 12px);
      --mdc-icon-size: 28px;
      color: var(--state-icon-color);
    }

    h2 {
      margin: 0;
      font-size: var(--ha-font-size-xl, 20px);
      font-weight: var(--ha-font-weight-normal, 400);
      color: var(--primary-text-color);
    }

    .sub {
      font-size: 13px;
      color: var(--secondary-text-color);
    }

    .banner {
      margin-top: var(--ha-space-3, 12px);
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(var(--rgb-warning-color, 255, 166, 0), 0.12);
      font-size: 13px;
    }

    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 16px;
      margin: var(--ha-space-4, 16px) 0 0;
      font-size: 14px;
    }

    dt {
      color: var(--secondary-text-color);
    }

    dd {
      margin: 0;
    }

    .actions {
      margin-top: var(--ha-space-4, 16px);
    }

    .actions button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 12px;
      border: 0;
      border-radius: 18px;
      background: transparent;
      color: var(--primary-color);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
      --mdc-icon-size: 18px;
    }

    .actions button:hover {
      background: rgba(var(--rgb-primary-color), 0.08);
    }
  `;
}

customElements.define("ee-detail-pane", EntityExplorerDetailPane);

declare global {
  interface HTMLElementTagNameMap {
    "ee-detail-pane": EntityExplorerDetailPane;
  }
}
