import type { ViewId } from "./tree/model";

export const VIEWS: Record<ViewId, { name: string; icon: string; note: string }> = {
  location: {
    name: "Location",
    icon: "mdi:home-outline",
    note: "Floor > Area > Device > Entity. Each entity appears once.",
  },
  network: {
    name: "Network",
    icon: "mdi:lan",
    note: "Integration > via_device chain > Entity.",
  },
  type: { name: "Type", icon: "mdi:shape-outline", note: "Domain > device class > Entity." },
  labels: {
    name: "Labels",
    icon: "mdi:label-outline",
    note: "Labels are many-to-many: entities can repeat here.",
  },
};
