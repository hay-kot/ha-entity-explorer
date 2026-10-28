import type {
  AreaRegistryEntry,
  DeviceRegistryEntry,
  EntityRegistryDisplayEntry,
  FloorRegistryEntry,
  LabelRegistryEntry,
} from "../hass";
import type { Registry } from "./model";

export interface FixtureOptions {
  seed?: number;
  // Roughly how many entities to generate. Devices scale with it.
  entities?: number;
}

const FLOORS: [string, string, number][] = [
  ["basement", "Basement", -1],
  ["ground", "Ground Floor", 0],
  ["upstairs", "Upstairs", 1],
];

const AREAS = [
  "Kitchen", "Living Room", "Dining Room", "Hallway", "Office", "Bedroom", "Guest Room",
  "Bathroom", "Laundry", "Garage", "Workshop", "Pantry", "Nursery", "Attic", "Den", "Mudroom",
];

const OUTDOOR_AREAS = ["Front Porch", "Backyard", "Driveway"];

const LABELS = ["security", "battery", "energy", "lighting", "climate", "notify", "vacation", "kids"];

interface DeviceKind {
  integration: string;
  model: string;
  entities: [domain: string, deviceClass?: string, category?: "diagnostic" | "config"][];
}

const KINDS: DeviceKind[] = [
  {
    integration: "zha",
    model: "Motion Sensor",
    entities: [
      ["binary_sensor", "occupancy"],
      ["sensor", "illuminance"],
      ["sensor", "battery", "diagnostic"],
    ],
  },
  {
    integration: "zha",
    model: "Smart Plug",
    entities: [["switch"], ["sensor", "power"], ["sensor", "energy"], ["update", undefined, "config"]],
  },
  {
    integration: "zha",
    model: "Contact Sensor",
    entities: [["binary_sensor", "door"], ["sensor", "battery", "diagnostic"]],
  },
  {
    integration: "zwave_js",
    model: "Relay",
    entities: [["switch"], ["switch"], ["sensor", "power"], ["button", undefined, "config"]],
  },
  {
    integration: "zwave_js",
    model: "Leak Sensor",
    entities: [["binary_sensor", "moisture"], ["sensor", "temperature"], ["sensor", "battery", "diagnostic"]],
  },
  { integration: "hue", model: "Color Bulb", entities: [["light"], ["update", undefined, "config"]] },
  {
    integration: "esphome",
    model: "Air Quality Monitor",
    entities: [
      ["sensor", "temperature"], ["sensor", "humidity"], ["sensor", "carbon_dioxide"],
      ["sensor", "pm25"], ["sensor", "signal_strength", "diagnostic"], ["button", "restart", "config"],
    ],
  },
  {
    integration: "ecobee",
    model: "Thermostat",
    entities: [["climate"], ["sensor", "temperature"], ["sensor", "humidity"], ["binary_sensor", "occupancy"]],
  },
  {
    integration: "frigate",
    model: "Camera",
    entities: [["camera"], ["binary_sensor", "occupancy"], ["switch"], ["sensor", undefined, "diagnostic"]],
  },
  { integration: "cast", model: "Speaker", entities: [["media_player"]] },
];

const HUBS: Record<string, string> = {
  zha: "Zigbee Coordinator",
  zwave_js: "Z-Wave Controller",
  hue: "Hue Bridge",
  frigate: "Frigate NVR",
};

const HELPERS: [platform: string, domain: string][] = [
  ["template", "sensor"],
  ["template", "binary_sensor"],
  ["input_boolean", "input_boolean"],
  ["input_number", "input_number"],
  ["automation", "automation"],
  ["script", "script"],
  ["group", "light"],
  ["timer", "timer"],
];

const INTEGRATION_NAMES: Record<string, string> = {
  zha: "Zigbee Home Automation",
  zwave_js: "Z-Wave",
  hue: "Philips Hue",
  esphome: "ESPHome",
  ecobee: "ecobee",
  frigate: "Frigate",
  cast: "Google Cast",
  template: "Template",
  input_boolean: "Toggle",
  input_number: "Number",
  automation: "Automation",
  script: "Script",
  group: "Group",
  timer: "Timer",
  sensor: "Sensor",
  binary_sensor: "Binary sensor",
};

// Anything not listed is a hub, as in HA.
const INTEGRATION_TYPES: Record<string, string> = {
  frigate: "service",
  cast: "service",
  template: "helper",
  input_boolean: "helper",
  input_number: "helper",
  group: "helper",
  timer: "helper",
  automation: "system",
  script: "system",
};

// Mulberry32: small, seedable, and good enough for test data.
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function syntheticRegistry(options: FixtureOptions = {}): Registry {
  const rand = random(options.seed ?? 1);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const target = options.entities ?? 1500;

  const floors: Record<string, FloorRegistryEntry> = {};
  for (const [floor_id, name, level] of FLOORS) {
    floors[floor_id] = { floor_id, name, level, icon: null };
  }

  const areas: Record<string, AreaRegistryEntry> = {};
  const addArea = (name: string, floor_id: string | null) => {
    const area_id = slug(name);
    areas[area_id] = { area_id, name, floor_id, icon: null };
  };
  AREAS.forEach((name, i) => addArea(name, FLOORS[i % FLOORS.length][0]));
  OUTDOOR_AREAS.forEach((name) => addArea(name, null));
  const areaIds = Object.keys(areas);

  const labels: LabelRegistryEntry[] = LABELS.map((name) => ({
    label_id: name,
    name,
    icon: null,
    color: null,
  }));

  const entryDomains: Record<string, string> = {};
  const entryTitles: Record<string, string> = {};
  const entryFor = (domain: string) => {
    const id = `entry_${domain}`;
    entryDomains[id] = domain;
    entryTitles[id] = INTEGRATION_NAMES[domain] ?? domain;
    return id;
  };

  const devices: Record<string, DeviceRegistryEntry> = {};
  const addDevice = (
    name: string,
    integration: string,
    area_id: string | null,
    via_device_id: string | null,
    model: string,
  ) => {
    const id = `dev_${Object.keys(devices).length}`;
    const entry = entryFor(integration);
    devices[id] = {
      id,
      name,
      name_by_user: null,
      area_id,
      via_device_id,
      primary_config_entry: entry,
      config_entries: [entry],
      manufacturer: INTEGRATION_NAMES[integration] ?? integration,
      model,
      labels: [],
    };
    return id;
  };

  // Hubs keep their own area; leaves chain through them, and some Zigbee
  // routers chain through other routers.
  const hubs: Record<string, string> = {};
  for (const [integration, name] of Object.entries(HUBS)) {
    hubs[integration] = addDevice(name, integration, "laundry", null, name);
  }

  const entities: Record<string, EntityRegistryDisplayEntry> = {};
  const entityNames: Record<string, string> = {};
  const deviceClasses: Record<string, string> = {};
  const addEntity = (
    domain: string,
    name: string,
    extra: Partial<EntityRegistryDisplayEntry>,
    deviceClass?: string,
  ) => {
    let entityId = `${domain}.${slug(name)}`;
    for (let n = 2; entities[entityId]; n++) entityId = `${domain}.${slug(name)}_${n}`;
    const labelCount = rand() < 0.3 ? 1 + Math.floor(rand() * 2) : 0;
    const entityLabels = new Set<string>();
    for (let i = 0; i < labelCount; i++) entityLabels.add(pick(LABELS));
    entities[entityId] = { entity_id: entityId, labels: [...entityLabels], ...extra };
    entityNames[entityId] = name;
    if (deviceClass) deviceClasses[entityId] = deviceClass;
  };

  const routers: string[] = [];
  const helperShare = 0.12;
  while (Object.keys(entities).length < target * (1 - helperShare)) {
    const kind = pick(KINDS);
    const roll = rand();
    const area = roll < 0.08 ? null : pick(areaIds);
    const name = `${area ? areas[area].name : "Spare"} ${kind.model} ${Object.keys(devices).length}`;
    let via: string | null = hubs[kind.integration] ?? null;
    if (kind.integration === "zha" && routers.length && rand() < 0.4) via = pick(routers);
    const deviceId = addDevice(name, kind.integration, area, via, kind.model);
    if (kind.model === "Smart Plug") routers.push(deviceId);

    for (const [domain, deviceClass, category] of kind.entities) {
      const overrideArea = rand() < 0.04 ? pick(areaIds) : undefined;
      addEntity(
        domain,
        `${name} ${deviceClass ? deviceClass.replace(/_/g, " ") : domain}`,
        {
          device_id: deviceId,
          platform: kind.integration,
          entity_category: category,
          ...(overrideArea ? { area_id: overrideArea } : {}),
        },
        deviceClass,
      );
    }
  }

  while (Object.keys(entities).length < target) {
    const [platform, domain] = pick(HELPERS);
    const area = rand() < 0.3 ? pick(areaIds) : undefined;
    addEntity(domain, `${humanizeHelper(platform)} ${Object.keys(entities).length}`, {
      platform,
      ...(area ? { area_id: area } : {}),
    });
  }

  return {
    entities,
    devices,
    areas,
    floors,
    labels,
    entryDomains,
    entryTitles,
    integrationNames: INTEGRATION_NAMES,
    integrationTypes: INTEGRATION_TYPES,
    entityNames,
    deviceClasses,
  };
}

function humanizeHelper(platform: string): string {
  return platform.charAt(0).toUpperCase() + platform.slice(1).replace(/_/g, " ");
}
