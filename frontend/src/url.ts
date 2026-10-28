import { VIEW_IDS, type ViewId } from "./tree/model";
import { CHIPS, type ChipId } from "./views";

// Deep link shape: /<panel>/<view>?entity=<entity id>&q=<search>&filter=<chip,chip>
// A selected folder, or an entity's second spot in the Labels view, uses
// node=<node id> instead. Node ids are path-shaped, so they also tell the panel
// which folders to open.
export interface UrlState {
  view: ViewId;
  entity?: string;
  node?: string;
  query: string;
  chips: ChipId[];
}

const CHIP_IDS = new Set<string>(CHIPS.map((c) => c.id));

export function readUrlState(
  basePath: string,
  { pathname, search }: Pick<Location, "pathname" | "search">,
): Partial<UrlState> {
  const [first] = pathname.slice(basePath.length).split("/").filter(Boolean);
  const params = new URLSearchParams(search);
  return {
    view: VIEW_IDS.find((v) => v === first),
    entity: params.get("entity") ?? undefined,
    node: params.get("node") ?? undefined,
    query: params.get("q") ?? "",
    chips: (params.get("filter") ?? "")
      .split(",")
      .filter((c): c is ChipId => CHIP_IDS.has(c)),
  };
}

export function urlFor(basePath: string, state: UrlState): string {
  const params = new URLSearchParams();
  if (state.entity) params.set("entity", state.entity);
  else if (state.node) params.set("node", state.node);
  if (state.query) params.set("q", state.query);
  if (state.chips.length) params.set("filter", state.chips.join(","));
  const search = params.toString();
  return `${basePath}/${state.view}${search ? `?${search}` : ""}`;
}
