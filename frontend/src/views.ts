import type { ViewId } from "./tree/model";

export const VIEWS: Record<ViewId, { name: string; icon: string }> = {
  location: { name: "Location", icon: "mdi:home-outline" },
  network: { name: "Network", icon: "mdi:lan" },
  type: { name: "Type", icon: "mdi:shape-outline" },
  labels: { name: "Labels", icon: "mdi:label-outline" },
};

export type ChipId = "unavailable" | "hide-diagnostic" | "hide-hidden";

export const CHIPS: { id: ChipId; label: string; icon: string }[] = [
  { id: "unavailable", label: "Unavailable only", icon: "mdi:alert-circle-outline" },
  { id: "hide-diagnostic", label: "Hide diagnostic", icon: "mdi:eye-off-outline" },
  { id: "hide-hidden", label: "Hide hidden", icon: "mdi:eye-off" },
];

export type TreeSize = "compact" | "default" | "large";

export const TREE_SIZES: { id: TreeSize; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "default", label: "Default" },
  { id: "large", label: "Large" },
];
