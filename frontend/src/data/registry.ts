import type {
  ConfigEntry,
  HomeAssistant,
  IntegrationManifest,
  LabelRegistryEntry,
} from "../hass";
import { entityDomain } from "../tree/build";
import type { Registry } from "../tree/model";

// Registry data that `hass` does not carry and the panel fetches itself.
export interface RegistryExtras {
  labels: LabelRegistryEntry[];
  entryDomains: Record<string, string>;
  entryTitles: Record<string, string>;
  integrationNames: Record<string, string>;
  integrationTypes: Record<string, string>;
}

export const EMPTY_EXTRAS: RegistryExtras = {
  labels: [],
  entryDomains: {},
  entryTitles: {},
  integrationNames: {},
  integrationTypes: {},
};

export async function fetchLabels(hass: HomeAssistant): Promise<LabelRegistryEntry[]> {
  return hass.callWS<LabelRegistryEntry[]>({ type: "config/label_registry/list" });
}

export async function fetchEntries(
  hass: HomeAssistant,
): Promise<Pick<RegistryExtras, "entryDomains" | "entryTitles">> {
  const entries = await hass.callWS<ConfigEntry[]>({ type: "config_entries/get" });
  return {
    entryDomains: Object.fromEntries(entries.map((e) => [e.entry_id, e.domain])),
    entryTitles: Object.fromEntries(entries.map((e) => [e.entry_id, e.title])),
  };
}

// manifest/list skips domains it does not know, so unknown platforms fall back
// to a humanized domain in the tree builders.
export async function fetchManifests(
  hass: HomeAssistant,
  domains: string[],
): Promise<IntegrationManifest[]> {
  if (!domains.length) return [];
  return hass.callWS<IntegrationManifest[]>({ type: "manifest/list", integrations: domains });
}

// Every domain a tree might label: config entry domains, entity platforms and
// entity domains.
export function referencedDomains(hass: HomeAssistant, entryDomains: Record<string, string>) {
  const domains = new Set(Object.values(entryDomains));
  for (const entity of Object.values(hass.entities)) {
    if (entity.platform) domains.add(entity.platform);
    domains.add(entityDomain(entity.entity_id));
  }
  return domains;
}

// Rebuilds the Registry only when a registry object changes identity. `hass`
// is a new object on every state change, but HA keeps the registry objects
// unless the registry itself changes.
//
// Names and device classes come from `hass.states`, yet a state change alone
// does not refresh them. Both change rarely, and an entity rename updates the
// entity registry, which does trigger a rebuild. The state count is in the key
// because entities without a unique ID exist only in `hass.states`.
export class RegistryCache {
  private key: unknown[] = [];
  private value?: Registry;

  get(hass: HomeAssistant, extras: RegistryExtras): Registry {
    const stateIds = Object.keys(hass.states);
    const key = [
      stateIds.length,
      hass.entities,
      hass.devices,
      hass.areas,
      hass.floors,
      extras.labels,
      extras.entryDomains,
      extras.entryTitles,
      extras.integrationNames,
      extras.integrationTypes,
    ];
    if (this.value && key.every((part, i) => part === this.key[i])) return this.value;

    const entities = { ...hass.entities };
    for (const entityId of stateIds) {
      entities[entityId] ??= { entity_id: entityId, labels: [] };
    }

    const entityNames: Record<string, string> = {};
    const deviceClasses: Record<string, string> = {};
    for (const entityId of Object.keys(entities)) {
      const attributes = hass.states[entityId]?.attributes;
      if (attributes?.friendly_name) entityNames[entityId] = attributes.friendly_name;
      if (attributes?.device_class) deviceClasses[entityId] = attributes.device_class;
    }

    this.key = key;
    this.value = {
      entities,
      devices: hass.devices,
      areas: hass.areas,
      floors: hass.floors,
      ...extras,
      entityNames,
      deviceClasses,
    };
    return this.value;
  }
}
