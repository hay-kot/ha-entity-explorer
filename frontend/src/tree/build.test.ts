import { describe, expect, it } from "vitest";

import type { DeviceRegistryEntry, EntityRegistryDisplayEntry } from "../hass";
import { buildView } from "./build";
import { syntheticRegistry } from "./fixture";
import { VIEW_IDS, type Registry, type TreeNode, type ViewId } from "./model";
import { distinctEntityCount, filterTree, findEntity, findNode, searchTree } from "./rows";

function device(id: string, extra: Partial<DeviceRegistryEntry> = {}): DeviceRegistryEntry {
  return {
    id,
    name: id,
    name_by_user: null,
    area_id: null,
    via_device_id: null,
    primary_config_entry: "entry_zha",
    config_entries: ["entry_zha"],
    manufacturer: null,
    model: null,
    labels: [],
    ...extra,
  };
}

function entity(
  entity_id: string,
  extra: Partial<EntityRegistryDisplayEntry> = {},
): EntityRegistryDisplayEntry {
  return { entity_id, labels: [], ...extra };
}

function registry(): Registry {
  const entities = [
    entity("switch.kitchen_plug", { device_id: "kitchen_plug", labels: ["energy"] }),
    entity("binary_sensor.kitchen_motion", { device_id: "kitchen_motion", labels: ["security"] }),
    entity("switch.porch_light", { device_id: "porch_relay" }),
    // Overrides its device's area (front_porch) to backyard.
    entity("switch.patio_lights", {
      device_id: "porch_relay",
      area_id: "backyard",
      labels: ["energy", "security"],
    }),
    entity("binary_sensor.vibration", { device_id: "vibration" }),
    entity("sensor.house_temp", { platform: "template" }),
    entity("sensor.total_power", { platform: "template", area_id: "utility" }),
    entity("sensor.coordinator_temp", { device_id: "coordinator" }),
  ];
  return {
    entities: Object.fromEntries(entities.map((e) => [e.entity_id, e])),
    devices: Object.fromEntries(
      [
        device("coordinator", { area_id: "utility" }),
        device("kitchen_plug", { area_id: "kitchen", via_device_id: "coordinator" }),
        device("kitchen_motion", { area_id: "kitchen", via_device_id: "kitchen_plug" }),
        device("porch_relay", {
          area_id: "front_porch",
          primary_config_entry: "entry_zwave",
          config_entries: ["entry_zwave"],
        }),
        device("vibration", { via_device_id: "coordinator" }),
      ].map((d) => [d.id, d]),
    ),
    areas: {
      kitchen: { area_id: "kitchen", name: "Kitchen", icon: null, floor_id: "ground" },
      front_porch: { area_id: "front_porch", name: "Front Porch", icon: null, floor_id: "outside" },
      backyard: { area_id: "backyard", name: "Backyard", icon: null, floor_id: "outside" },
      utility: { area_id: "utility", name: "Utility", icon: null, floor_id: null },
    },
    floors: {
      ground: { floor_id: "ground", name: "Ground", icon: null, level: 0 },
      outside: { floor_id: "outside", name: "Outside", icon: null, level: null },
    },
    labels: [
      { label_id: "security", name: "security", icon: null, color: null },
      { label_id: "energy", name: "energy", icon: null, color: null },
    ],
    entryDomains: { entry_zha: "zha", entry_zwave: "zwave_js" },
    entryTitles: { entry_zha: "Zigbee stick", entry_zwave: "Z-Wave stick" },
    integrationNames: { zha: "Zigbee Home Automation", zwave_js: "Z-Wave", template: "Template" },
    integrationTypes: { template: "helper" },
    entityNames: {},
    deviceClasses: { "binary_sensor.kitchen_motion": "occupancy", "sensor.total_power": "power" },
  };
}

// Labels of a subtree as nested arrays, which keeps expectations readable.
function shape(nodes: TreeNode[]): unknown[] {
  return nodes.map((n) => (n.children.length ? [n.label, shape(n.children)] : n.label));
}

function at(roots: TreeNode[], ...labels: string[]): TreeNode {
  let nodes = roots;
  let found: TreeNode | undefined;
  for (const label of labels) {
    found = nodes.find((n) => n.label === label);
    if (!found) throw new Error(`no node "${label}" in [${nodes.map((n) => n.label).join(", ")}]`);
    nodes = found.children;
  }
  return found!;
}

function entityOccurrences(roots: TreeNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.entityId) counts.set(n.entityId, (counts.get(n.entityId) ?? 0) + 1);
      visit(n.children);
    }
  };
  visit(roots);
  return counts;
}

describe("location view", () => {
  const roots = buildView("location", registry());

  it("orders floors by level, then No floor and Unassigned", () => {
    expect(roots.map((n) => n.label)).toEqual(["Ground", "Outside", "No floor", "Unassigned"]);
  });

  it("puts an overridden entity only in its own area, under a partial device", () => {
    const backyard = at(roots, "Outside", "Backyard", "porch_relay");
    expect(backyard.partial).toBe("1 of 2");
    expect(backyard.children.map((n) => n.entityId)).toEqual(["switch.patio_lights"]);
    expect(backyard.children[0].override).toBe(true);

    const porch = at(roots, "Outside", "Front Porch", "porch_relay");
    expect(porch.partial).toBeUndefined();
    expect(porch.children.map((n) => n.entityId)).toEqual(["switch.porch_light"]);
  });

  it("lists device-less entities after devices in their area", () => {
    expect(shape(at(roots, "No floor", "Utility").children)).toEqual([
      ["coordinator", ["sensor.coordinator_temp"]],
      "sensor.total_power",
    ]);
  });

  it("collects devices and entities without an area under Unassigned", () => {
    expect(shape(at(roots, "Unassigned").children)).toEqual([
      ["Devices without area", [["vibration", ["binary_sensor.vibration"]]]],
      ["Entities without device or area", ["sensor.house_temp"]],
    ]);
  });

  it("counts entities per folder", () => {
    expect(at(roots, "Outside").entityCount).toBe(2);
    expect(at(roots, "Ground", "Kitchen").entityCount).toBe(2);
  });
});

describe("network view", () => {
  const roots = buildView("network", registry());

  it("groups integrations by integration type, devices first", () => {
    expect(roots.map((n) => n.label)).toEqual(["Devices & hubs", "Helpers"]);
    expect(at(roots, "Devices & hubs").children.map((n) => n.label)).toEqual([
      "Z-Wave",
      "Zigbee Home Automation",
    ]);
  });

  it("nests devices along the via_device chain", () => {
    expect(shape(at(roots, "Devices & hubs", "Zigbee Home Automation").children)).toEqual([
      [
        "coordinator",
        [
          [
            "kitchen_plug",
            [["kitchen_motion", ["binary_sensor.kitchen_motion"]], "switch.kitchen_plug"],
          ],
          ["vibration", ["binary_sensor.vibration"]],
          "sensor.coordinator_temp",
        ],
      ],
    ]);
  });

  it("puts device-less entities under their integration", () => {
    expect(shape(at(roots, "Helpers", "Template").children)).toEqual([
      "sensor.house_temp",
      "sensor.total_power",
    ]);
  });

  it("splits device-less entities by domain when they span several", () => {
    const reg = registry();
    reg.entities["binary_sensor.anyone_home"] = entity("binary_sensor.anyone_home", {
      platform: "template",
    });
    const roots = buildView("network", reg);
    expect(shape(at(roots, "Helpers", "Template").children)).toEqual([
      ["Binary sensor", ["binary_sensor.anyone_home"]],
      ["Sensor", ["sensor.house_temp", "sensor.total_power"]],
    ]);
  });

  it("adds a config entry level only when an integration has several entries", () => {
    const reg = registry();
    reg.entryDomains.entry_zwave_2 = "zwave_js";
    reg.entryTitles.entry_zwave_2 = "Garage stick";
    reg.devices.garage_relay = device("garage_relay", {
      primary_config_entry: "entry_zwave_2",
      config_entries: ["entry_zwave_2"],
    });
    const roots = buildView("network", reg);
    expect(shape(at(roots, "Devices & hubs", "Z-Wave").children)).toEqual([
      ["Garage stick", ["garage_relay"]],
      ["Z-Wave stick", [["porch_relay", ["switch.patio_lights", "switch.porch_light"]]]],
    ]);
    expect(at(roots, "Devices & hubs", "Z-Wave", "Garage stick").entryId).toBe("entry_zwave_2");
  });

  it("groups entities without a registry entry on their own", () => {
    const reg = registry();
    reg.entities["sun.sun"] = entity("sun.sun");
    const roots = buildView("network", reg);
    expect(roots.at(-1)?.label).toBe("Not in entity registry");
    expect(shape(roots.at(-1)!.children)).toEqual(["sun.sun"]);
  });

  it("keeps devices in a via_device cycle", () => {
    const reg = registry();
    reg.devices.kitchen_plug.via_device_id = "kitchen_motion";
    const cyclic = buildView("network", reg);
    const ids = new Set<string>();
    const visit = (nodes: TreeNode[]) =>
      nodes.forEach((n) => {
        if (n.deviceId) ids.add(n.deviceId);
        visit(n.children);
      });
    visit(cyclic);
    expect([...ids].sort()).toEqual(Object.keys(reg.devices).sort());
  });
});

describe("type view", () => {
  const roots = buildView("type", registry());

  it("splits sensors by device class, unclassified last", () => {
    expect(at(roots, "Sensor").children.map((n) => n.label)).toEqual(["Power", "No device class"]);
  });

  it("keeps other domains flat", () => {
    expect(at(roots, "Switch").children.every((n) => n.kind === "entity")).toBe(true);
  });
});

describe("labels view", () => {
  it("repeats an entity under each of its labels", () => {
    const roots = buildView("labels", registry());
    expect(entityOccurrences(roots).get("switch.patio_lights")).toBe(2);
    expect(at(roots, "security").entityCount).toBe(2);
  });
});

describe("synthetic fixture", () => {
  const reg = syntheticRegistry({ entities: 1500 });
  const total = Object.keys(reg.entities).length;

  it.each<ViewId>(["location", "network", "type"])("%s view holds each entity once", (view) => {
    const counts = entityOccurrences(buildView(view, reg));
    expect(counts.size).toBe(total);
    expect([...counts.values()].every((c) => c === 1)).toBe(true);
  });

  it("builds every view quickly", () => {
    const start = performance.now();
    for (const view of VIEW_IDS) buildView(view, reg);
    const elapsed = performance.now() - start;
    console.info(`built ${VIEW_IDS.length} views over ${total} entities in ${elapsed.toFixed(1)}ms`);
    // A generous bound: this guards against accidental quadratic work, not
    // against a slow CI machine.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("rows", () => {
  const roots = buildView("location", registry());

  it("filters entities and drops empty folders", () => {
    const filtered = filterTree(roots, (id) => id.startsWith("switch."));
    expect(filtered.map((n) => n.label)).toEqual(["Ground", "Outside"]);
    expect(distinctEntityCount(filtered)).toBe(3);
    expect(filtered[0].entityCount).toBe(1);
  });

  it("searches names and ids with the path in the view", () => {
    const results = searchTree(roots, "patio");
    expect(results).toHaveLength(1);
    expect(results[0].path).toEqual(["Outside", "Backyard", "porch_relay"]);
  });

  it("lists every entity for a blank search", () => {
    expect(searchTree(roots, "  ")).toHaveLength(distinctEntityCount(roots));
  });

  it("finds a node by id and an entity by entity id", () => {
    const hit = findEntity(roots, "switch.patio_lights")!;
    expect(hit.ancestors.map((n) => n.label)).toEqual(["Outside", "Backyard", "porch_relay"]);
    expect(findNode(roots, hit.node.id)?.node).toBe(hit.node);
  });
});
