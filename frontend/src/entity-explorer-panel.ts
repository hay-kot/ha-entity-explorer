import { LitElement, css, html } from "lit";

import type { HomeAssistant, PanelInfo } from "./hass";

export class EntityExplorerPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    panel: { attribute: false },
  };

  declare hass?: HomeAssistant;
  declare narrow: boolean;
  declare panel?: PanelInfo;

  static styles = css`
    :host {
      display: block;
      min-height: 100%;
      padding: var(--ha-space-4, 16px);
      box-sizing: border-box;
      background: var(--primary-background-color);
      color: var(--primary-text-color);
      font-family: var(--ha-font-family-body, Roboto, sans-serif);
    }

    h1 {
      margin: 0 0 var(--ha-space-4, 16px);
      font-size: var(--ha-font-size-2xl, 24px);
      font-weight: var(--ha-font-weight-normal, 400);
    }

    dl {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: var(--ha-space-4, 16px);
      margin: 0;
    }

    div.count {
      padding: var(--ha-space-4, 16px);
      border: 1px solid var(--divider-color);
      border-radius: var(--ha-card-border-radius, 12px);
      background: var(--card-background-color);
    }

    dt {
      color: var(--secondary-text-color);
    }

    dd {
      margin: var(--ha-space-1, 4px) 0 0;
      font-size: var(--ha-font-size-2xl, 24px);
      color: var(--primary-color);
    }
  `;

  constructor() {
    super();
    this.narrow = false;
  }

  render() {
    if (!this.hass) {
      return html``;
    }

    const counts: [string, number][] = [
      ["Entities", Object.keys(this.hass.entities).length],
      ["Devices", Object.keys(this.hass.devices).length],
      ["Areas", Object.keys(this.hass.areas).length],
    ];

    return html`
      <h1>${this.panel?.title ?? "Entity Explorer"}</h1>
      <dl>
        ${counts.map(
          ([label, count]) => html`
            <div class="count">
              <dt>${label}</dt>
              <dd>${count}</dd>
            </div>
          `,
        )}
      </dl>
    `;
  }
}

customElements.define("entity-explorer-panel", EntityExplorerPanel);

declare global {
  interface HTMLElementTagNameMap {
    "entity-explorer-panel": EntityExplorerPanel;
  }
}
