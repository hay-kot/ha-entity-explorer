import type {
  AreaRegistryEntry,
  DeviceRegistryEntry,
  EntityRegistryDisplayEntry,
  FloorRegistryEntry,
  LabelRegistryEntry,
} from "../hass";

export type ViewId = "location" | "network" | "type" | "labels";

export const VIEW_IDS: ViewId[] = ["location", "network", "type", "labels"];

export type NodeKind =
  | "floor"
  | "area"
  | "device"
  | "entity"
  | "category"
  | "integration"
  | "entry"
  | "domain"
  | "class"
  | "label"
  | "group";

export interface TreeNode {
  // Path-shaped and unique within one view. Device nodes can repeat in the
  // Location view and entity nodes repeat in the Labels view, so the id of the
  // underlying registry item is not unique on its own.
  id: string;
  label: string;
  kind: NodeKind;
  icon?: string;
  children: TreeNode[];
  entityId?: string;
  deviceId?: string;
  areaId?: string;
  domain?: string;
  entryId?: string;
  // Set on a device node shown in an area other than its own: "1 of 2".
  partial?: string;
  // Set on an entity whose area differs from its device's area.
  override?: boolean;
  muted?: boolean;
  // Distinct entities in this subtree.
  entityCount: number;
}

// Everything the builders read. Plain data, so tests and the synthetic
// fixture can build trees without a running Home Assistant.
export interface Registry {
  entities: Record<string, EntityRegistryDisplayEntry>;
  devices: Record<string, DeviceRegistryEntry>;
  areas: Record<string, AreaRegistryEntry>;
  floors: Record<string, FloorRegistryEntry>;
  labels: LabelRegistryEntry[];
  // Config entry id to integration domain.
  entryDomains: Record<string, string>;
  entryTitles: Record<string, string>;
  // Integration domain to display name.
  integrationNames: Record<string, string>;
  // Integration domain to manifest integration_type: hub, service, helper...
  integrationTypes: Record<string, string>;
  entityNames: Record<string, string>;
  deviceClasses: Record<string, string>;
}
