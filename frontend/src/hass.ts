// The subset of Home Assistant's frontend `hass` object the panel reads.
// HA does not publish these types, so only fields in use are declared.
export interface HomeAssistant {
  entities: Record<string, unknown>;
  devices: Record<string, unknown>;
  areas: Record<string, unknown>;
}

export interface PanelInfo {
  url_path: string;
  title: string | null;
  config: Record<string, unknown> | null;
}
