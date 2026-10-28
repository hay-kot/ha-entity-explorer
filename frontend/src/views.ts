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

export type ChipId = "unavailable" | "hide-diagnostic" | "hide-hidden";

export const CHIPS: { id: ChipId; label: string; icon: string }[] = [
  { id: "unavailable", label: "Unavailable only", icon: "mdi:alert-circle-outline" },
  { id: "hide-diagnostic", label: "Hide diagnostic", icon: "mdi:eye-off-outline" },
  { id: "hide-hidden", label: "Hide hidden", icon: "mdi:eye-off" },
];
