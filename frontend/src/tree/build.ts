import type { DeviceRegistryEntry, EntityRegistryDisplayEntry } from "../hass";
import type { NodeKind, Registry, TreeNode, ViewId } from "./model";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const SENSOR_DOMAINS_WITH_CLASSES = new Set(["sensor", "binary_sensor"]);

export interface BuildOptions {
  // Puts Network integrations under integration type folders. On by default.
  groupNetwork?: boolean;
}

export function buildView(view: ViewId, reg: Registry, options: BuildOptions = {}): TreeNode[] {
  const index = indexRegistry(reg);
  switch (view) {
    case "location":
      return buildLocation(reg, index);
    case "network":
      return buildNetwork(reg, index, options.groupNetwork ?? true);
    case "type":
      return buildType(reg, index);
    case "labels":
      return buildLabels(reg, index);
  }
}

export function deviceName(device: DeviceRegistryEntry): string {
  return device.name_by_user || device.name || device.id;
}

export function entityName(reg: Registry, entityId: string): string {
  return reg.entityNames[entityId] || reg.entities[entityId]?.name || entityId;
}

export function entityDomain(entityId: string): string {
  return entityId.slice(0, entityId.indexOf("."));
}

export function humanize(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface RegistryIndex {
  // Entities of each device, sorted by name.
  byDevice: Map<string, EntityRegistryDisplayEntry[]>;
  // Entities whose device is unset or unknown, sorted by name.
  deviceless: EntityRegistryDisplayEntry[];
  // All entities, sorted by name.
  sorted: EntityRegistryDisplayEntry[];
  deviceOf(entity: EntityRegistryDisplayEntry): DeviceRegistryEntry | undefined;
}

function indexRegistry(reg: Registry): RegistryIndex {
  const sorted = Object.values(reg.entities).sort((a, b) =>
    collator.compare(entityName(reg, a.entity_id), entityName(reg, b.entity_id)),
  );
  const deviceOf = (e: EntityRegistryDisplayEntry) =>
    e.device_id ? reg.devices[e.device_id] : undefined;

  const byDevice = new Map<string, EntityRegistryDisplayEntry[]>();
  const deviceless: EntityRegistryDisplayEntry[] = [];
  for (const e of sorted) {
    const device = deviceOf(e);
    if (!device) {
      deviceless.push(e);
      continue;
    }
    const list = byDevice.get(device.id);
    if (list) list.push(e);
    else byDevice.set(device.id, [e]);
  }
  return { byDevice, deviceless, sorted, deviceOf };
}

function folder(
  parentId: string,
  key: string,
  kind: NodeKind,
  label: string,
  extra: Partial<TreeNode> = {},
): TreeNode {
  return { id: `${parentId}/${key}`, label, kind, children: [], entityCount: 0, ...extra };
}

function entityNode(
  parentId: string,
  reg: Registry,
  entity: EntityRegistryDisplayEntry,
  extra: Partial<TreeNode> = {},
): TreeNode {
  return {
    id: `${parentId}/${entity.entity_id}`,
    label: entityName(reg, entity.entity_id),
    kind: "entity",
    entityId: entity.entity_id,
    children: [],
    entityCount: 1,
    ...extra,
  };
}

function sortByLabel(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => collator.compare(a.label, b.label));
}

// Every view keeps an entity at most once per subtree, so summing children
// counts distinct entities.
function countEntities(node: TreeNode): number {
  if (node.kind === "entity") return 1;
  node.entityCount = node.children.reduce((sum, c) => sum + countEntities(c), 0);
  return node.entityCount;
}

function finish(roots: TreeNode[]): TreeNode[] {
  roots.forEach(countEntities);
  return roots;
}

// ---------- Location: Floor > Area > Device > Entity ----------

function buildLocation(reg: Registry, index: RegistryIndex): TreeNode[] {
  const root = "location";
  const knownArea = (id: string | null | undefined) => (id && reg.areas[id] ? id : null);
  const effectiveArea = (e: EntityRegistryDisplayEntry) =>
    knownArea(e.area_id) ?? knownArea(index.deviceOf(e)?.area_id);

  // A device shows in its own area and in every other area that one of its
  // entities resolves to.
  const devicesByArea = new Map<string | null, Set<string>>();
  const addDevice = (areaId: string | null, deviceId: string) => {
    const set = devicesByArea.get(areaId);
    if (set) set.add(deviceId);
    else devicesByArea.set(areaId, new Set([deviceId]));
  };
  for (const device of Object.values(reg.devices)) {
    addDevice(knownArea(device.area_id), device.id);
  }
  const devicelessByArea = new Map<string | null, EntityRegistryDisplayEntry[]>();
  for (const e of index.sorted) {
    const areaId = effectiveArea(e);
    const device = index.deviceOf(e);
    if (device) {
      addDevice(areaId, device.id);
      continue;
    }
    const list = devicelessByArea.get(areaId);
    if (list) list.push(e);
    else devicelessByArea.set(areaId, [e]);
  }

  const deviceNode = (parentId: string, device: DeviceRegistryEntry, areaId: string | null) => {
    const all = index.byDevice.get(device.id) ?? [];
    const here = all.filter((e) => effectiveArea(e) === areaId);
    const ownArea = knownArea(device.area_id) === areaId;
    const node = folder(parentId, `device:${device.id}`, "device", deviceName(device), {
      deviceId: device.id,
      partial: ownArea ? undefined : `${here.length} of ${all.length}`,
      muted: !ownArea,
    });
    node.children = here.map((e) =>
      entityNode(node.id, reg, e, {
        override: Boolean(e.area_id && knownArea(e.area_id) !== knownArea(device.area_id)),
      }),
    );
    return node;
  };

  const fillArea = (node: TreeNode, areaId: string | null) => {
    const devices = [...(devicesByArea.get(areaId) ?? [])].map((id) =>
      deviceNode(node.id, reg.devices[id], areaId),
    );
    const entities = (devicelessByArea.get(areaId) ?? []).map((e) => entityNode(node.id, reg, e));
    node.children = [...sortByLabel(devices), ...entities];
    return node;
  };

  const areaNode = (parentId: string, areaId: string) => {
    const area = reg.areas[areaId];
    return fillArea(
      folder(parentId, `area:${areaId}`, "area", area.name, {
        areaId,
        icon: area.icon ?? "mdi:texture-box",
      }),
      areaId,
    );
  };

  const areasByFloor = new Map<string | null, string[]>();
  for (const area of Object.values(reg.areas)) {
    const floorId = area.floor_id && reg.floors[area.floor_id] ? area.floor_id : null;
    const list = areasByFloor.get(floorId);
    if (list) list.push(area.area_id);
    else areasByFloor.set(floorId, [area.area_id]);
  }
  const areaChildren = (parentId: string, floorId: string | null) =>
    sortByLabel((areasByFloor.get(floorId) ?? []).map((id) => areaNode(parentId, id)));

  const floors = Object.values(reg.floors).sort(
    (a, b) =>
      (a.level ?? Number.MAX_SAFE_INTEGER) - (b.level ?? Number.MAX_SAFE_INTEGER) ||
      collator.compare(a.name, b.name),
  );
  const roots = floors.map((floor) => {
    const node = folder(root, `floor:${floor.floor_id}`, "floor", floor.name, {
      icon: floor.icon ?? "mdi:home-floor-0",
    });
    node.children = areaChildren(node.id, floor.floor_id);
    return node;
  });

  if (areasByFloor.has(null)) {
    const noFloor = folder(root, "no-floor", "group", "No floor", {
      icon: "mdi:layers-off-outline",
      muted: true,
    });
    noFloor.children = areaChildren(noFloor.id, null);
    roots.push(noFloor);
  }

  const unassigned = folder(root, "unassigned", "group", "Unassigned", {
    icon: "mdi:help-circle-outline",
    muted: true,
  });
  const unassignedDevices = [...(devicesByArea.get(null) ?? [])];
  if (unassignedDevices.length) {
    const group = folder(unassigned.id, "devices", "group", "Devices without area", {
      icon: "mdi:devices",
    });
    group.children = sortByLabel(
      unassignedDevices.map((id) => deviceNode(group.id, reg.devices[id], null)),
    );
    unassigned.children.push(group);
  }
  const unassignedEntities = devicelessByArea.get(null) ?? [];
  if (unassignedEntities.length) {
    const group = folder(unassigned.id, "entities", "group", "Entities without device or area", {
      icon: "mdi:shape-outline",
    });
    group.children = unassignedEntities.map((e) => entityNode(group.id, reg, e));
    unassigned.children.push(group);
  }
  if (unassigned.children.length) roots.push(unassigned);

  return finish(roots);
}

// ---------- Network: Category > Integration > Entry > via_device chain > Entity ----------

// Grouped like the manifest integration_type. HA treats a missing type as
// "hub", so unknown and not yet loaded integrations land under devices.
const NETWORK_CATEGORIES: { key: string; label: string; icon: string; types: string[] }[] = [
  { key: "devices", label: "Devices & hubs", icon: "mdi:router-wireless", types: ["hub", "device", "hardware"] },
  { key: "services", label: "Services", icon: "mdi:cloud-outline", types: ["service"] },
  { key: "helpers", label: "Helpers", icon: "mdi:tools", types: ["helper"] },
  { key: "system", label: "System", icon: "mdi:cog-outline", types: ["system", "entity", "virtual"] },
];

function networkCategory(reg: Registry, domain: string) {
  const type = reg.integrationTypes[domain] ?? "hub";
  return NETWORK_CATEGORIES.find((c) => c.types.includes(type)) ?? NETWORK_CATEGORIES[0];
}

function buildNetwork(reg: Registry, index: RegistryIndex, grouped: boolean): TreeNode[] {
  const root = "network";
  const entryOf = (device: DeviceRegistryEntry) =>
    (device.primary_config_entry && reg.entryDomains[device.primary_config_entry]
      ? device.primary_config_entry
      : device.config_entries.find((id) => reg.entryDomains[id])) ?? undefined;
  const integrationOf = (device: DeviceRegistryEntry) => {
    const entry = entryOf(device);
    return entry ? reg.entryDomains[entry] : "unknown";
  };

  const childDevices = new Map<string, DeviceRegistryEntry[]>();
  const rootDevices = new Map<string, DeviceRegistryEntry[]>();
  const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const device of Object.values(reg.devices)) {
    if (device.via_device_id && reg.devices[device.via_device_id]) {
      push(childDevices, device.via_device_id, device);
    } else {
      push(rootDevices, integrationOf(device), device);
    }
  }

  const placed = new Set<string>();
  const deviceTree = (parentId: string, device: DeviceRegistryEntry): TreeNode => {
    placed.add(device.id);
    const node = folder(parentId, `device:${device.id}`, "device", deviceName(device), {
      deviceId: device.id,
    });
    const children = (childDevices.get(device.id) ?? [])
      .filter((child) => !placed.has(child.id))
      .map((child) => deviceTree(node.id, child));
    const entities = (index.byDevice.get(device.id) ?? []).map((e) => entityNode(node.id, reg, e));
    node.children = [...sortByLabel(children), ...entities];
    return node;
  };

  // Every entity registry entry has a platform. Entities without one exist
  // only in the state machine, and HA cannot say which integration owns them.
  const unregistered: EntityRegistryDisplayEntry[] = [];
  const devicelessByPlatform = new Map<string, EntityRegistryDisplayEntry[]>();
  for (const e of index.deviceless) {
    if (e.platform) push(devicelessByPlatform, e.platform, e);
    else unregistered.push(e);
  }

  const categories = new Map<string, TreeNode>();
  const categoryNode = (domain: string) => {
    const category = networkCategory(reg, domain);
    let node = categories.get(category.key);
    if (!node) {
      node = folder(root, `category:${category.key}`, "category", category.label, {
        icon: category.icon,
      });
      categories.set(category.key, node);
    }
    return node;
  };

  const integrations = new Map<string, TreeNode>();
  const integrationNode = (domain: string) => {
    let node = integrations.get(domain);
    if (!node) {
      const parent = grouped ? categoryNode(domain) : undefined;
      node = folder(
        parent?.id ?? root,
        `integration:${domain}`,
        "integration",
        integrationName(reg, domain),
        { domain, icon: "mdi:puzzle-outline" },
      );
      parent?.children.push(node);
      integrations.set(domain, node);
    }
    return node;
  };

  // An integration with one config entry, the common case, skips the entry
  // level. With several (two Hue bridges, two ESPHome boards) the entry title
  // is what tells them apart.
  const rootDeviceNodes = (node: TreeNode, domain: string, devices: DeviceRegistryEntry[]) => {
    const byEntry = new Map<string, DeviceRegistryEntry[]>();
    for (const device of devices) push(byEntry, entryOf(device) ?? "", device);
    if (byEntry.size < 2) return sortByLabel(devices.map((d) => deviceTree(node.id, d)));
    return sortByLabel(
      [...byEntry].map(([entryId, list]) => {
        const entry = folder(node.id, `entry:${entryId}`, "entry", reg.entryTitles[entryId] || entryId, {
          domain,
          entryId: entryId || undefined,
          icon: "mdi:link-variant",
        });
        entry.children = sortByLabel(list.map((d) => deviceTree(entry.id, d)));
        return entry;
      }),
    );
  };

  // Helper-style integrations own entities of many domains (template sensors
  // and binary sensors, group lights and switches). A long mixed list reads
  // better split by domain.
  const devicelessNodes = (node: TreeNode, entities: EntityRegistryDisplayEntry[]) => {
    const byDomain = new Map<string, EntityRegistryDisplayEntry[]>();
    for (const e of entities) push(byDomain, entityDomain(e.entity_id), e);
    if (byDomain.size < 2) return entities.map((e) => entityNode(node.id, reg, e));
    return sortByLabel(
      [...byDomain].map(([domain, list]) => {
        const group = folder(node.id, `domain:${domain}`, "domain", integrationName(reg, domain), {
          domain,
        });
        group.children = list.map((e) => entityNode(group.id, reg, e));
        return group;
      }),
    );
  };

  const domains = new Set([...rootDevices.keys(), ...devicelessByPlatform.keys()]);
  for (const domain of domains) {
    const node = integrationNode(domain);
    node.children = [
      ...rootDeviceNodes(node, domain, rootDevices.get(domain) ?? []),
      ...devicelessNodes(node, devicelessByPlatform.get(domain) ?? []),
    ];
  }

  // A via_device_id cycle leaves devices that no root reaches. Show them at the
  // top of their integration rather than drop them.
  for (const device of Object.values(reg.devices)) {
    if (placed.has(device.id)) continue;
    const node = integrationNode(integrationOf(device));
    node.children.push(deviceTree(node.id, device));
  }

  const roots = grouped
    ? NETWORK_CATEGORIES.flatMap((c) => {
        const node = categories.get(c.key);
        if (!node) return [];
        sortByLabel(node.children);
        return [node];
      })
    : sortByLabel([...integrations.values()]);
  if (unregistered.length) {
    const group = folder(root, "unregistered", "group", "Not in entity registry", {
      icon: "mdi:help-circle-outline",
      muted: true,
    });
    group.children = unregistered.map((e) => entityNode(group.id, reg, e));
    roots.push(group);
  }
  return finish(roots);
}

function integrationName(reg: Registry, domain: string): string {
  if (domain === "unknown") return "Unknown integration";
  return reg.integrationNames[domain] ?? humanize(domain);
}

// ---------- Type: Domain > device class > Entity ----------

function buildType(reg: Registry, index: RegistryIndex): TreeNode[] {
  const root = "type";
  const byDomain = new Map<string, EntityRegistryDisplayEntry[]>();
  for (const e of index.sorted) {
    const domain = entityDomain(e.entity_id);
    const list = byDomain.get(domain);
    if (list) list.push(e);
    else byDomain.set(domain, [e]);
  }

  const roots = [...byDomain].map(([domain, entities]) => {
    const node = folder(root, `domain:${domain}`, "domain", integrationName(reg, domain), {
      domain,
    });
    if (!SENSOR_DOMAINS_WITH_CLASSES.has(domain)) {
      node.children = entities.map((e) => entityNode(node.id, reg, e));
      return node;
    }
    const byClass = new Map<string, EntityRegistryDisplayEntry[]>();
    for (const e of entities) {
      const deviceClass = reg.deviceClasses[e.entity_id] ?? "";
      const list = byClass.get(deviceClass);
      if (list) list.push(e);
      else byClass.set(deviceClass, [e]);
    }
    const classes = sortByLabel(
      [...byClass]
        .filter(([deviceClass]) => deviceClass)
        .map(([deviceClass, list]) => classNode(node.id, deviceClass, humanize(deviceClass), list)),
    );
    const unclassified = byClass.get("");
    if (unclassified) {
      classes.push(classNode(node.id, "", "No device class", unclassified, true));
    }
    node.children = classes;
    return node;
  });

  function classNode(
    parentId: string,
    key: string,
    label: string,
    entities: EntityRegistryDisplayEntry[],
    muted = false,
  ): TreeNode {
    const node = folder(parentId, `class:${key}`, "class", label, { icon: "mdi:shape-outline", muted });
    node.children = entities.map((e) => entityNode(node.id, reg, e));
    return node;
  }

  return finish(sortByLabel(roots));
}

// ---------- Labels: Label > Entity (many-to-many) ----------

function buildLabels(reg: Registry, index: RegistryIndex): TreeNode[] {
  const root = "labels";
  const byLabel = new Map<string, EntityRegistryDisplayEntry[]>();
  for (const e of index.sorted) {
    for (const labelId of e.labels) {
      const list = byLabel.get(labelId);
      if (list) list.push(e);
      else byLabel.set(labelId, [e]);
    }
  }
  const roots = reg.labels.map((label) => {
    const node = folder(root, `label:${label.label_id}`, "label", label.name, {
      icon: label.icon ?? "mdi:label-outline",
    });
    node.children = (byLabel.get(label.label_id) ?? []).map((e) => entityNode(node.id, reg, e));
    return node;
  });
  return finish(sortByLabel(roots));
}
