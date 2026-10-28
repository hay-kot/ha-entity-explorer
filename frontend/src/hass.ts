// The subset of Home Assistant's frontend `hass` object the panel reads.
// HA does not publish these types, so only fields in use are declared. The
// shapes match what HA 2026.10 sends to the frontend.

export interface EntityRegistryDisplayEntry {
  entity_id: string;
  name?: string | null;
  icon?: string;
  device_id?: string;
  area_id?: string;
  labels: string[];
  hidden?: boolean;
  entity_category?: "config" | "diagnostic";
  platform?: string;
}

export interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user: string | null;
  area_id: string | null;
  via_device_id: string | null;
  primary_config_entry: string | null;
  config_entries: string[];
  manufacturer: string | null;
  model: string | null;
  labels: string[];
}

export interface AreaRegistryEntry {
  area_id: string;
  name: string;
  icon: string | null;
  floor_id: string | null;
}

export interface FloorRegistryEntry {
  floor_id: string;
  name: string;
  icon: string | null;
  level: number | null;
}

export interface LabelRegistryEntry {
  label_id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

export interface ConfigEntry {
  entry_id: string;
  domain: string;
  title: string;
}

export interface IntegrationManifest {
  domain: string;
  name: string;
}

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    device_class?: string;
    icon?: string;
    [key: string]: unknown;
  };
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  entities: Record<string, EntityRegistryDisplayEntry>;
  devices: Record<string, DeviceRegistryEntry>;
  areas: Record<string, AreaRegistryEntry>;
  floors: Record<string, FloorRegistryEntry>;
  connection: {
    subscribeEvents(callback: () => void, eventType: string): Promise<() => void>;
  };
  callWS<T>(msg: { type: string; [key: string]: unknown }): Promise<T>;
  formatEntityState(stateObj: HassEntity): string;
}

export interface PanelInfo {
  url_path: string;
  title: string | null;
  config: Record<string, unknown> | null;
}
