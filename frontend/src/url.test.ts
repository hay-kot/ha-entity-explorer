import { describe, expect, it } from "vitest";

import { readUrlState, urlFor } from "./url";

const at = (url: string) => {
  const { pathname, search } = new URL(url, "http://ha.local");
  return { pathname, search };
};

describe("deep links", () => {
  it("round-trips view, entity, search and filters", () => {
    const url = urlFor("/entity-explorer", {
      view: "network",
      entity: "light.ceiling_lights",
      query: "kitchen light",
      chips: ["hide-diagnostic", "unavailable"],
    });
    expect(url).toBe(
      "/entity-explorer/network?entity=light.ceiling_lights&q=kitchen+light&filter=hide-diagnostic%2Cunavailable",
    );
    expect(readUrlState("/entity-explorer", at(url))).toEqual({
      view: "network",
      entity: "light.ceiling_lights",
      node: undefined,
      query: "kitchen light",
      chips: ["hide-diagnostic", "unavailable"],
    });
  });

  it("keeps a node id with slashes and colons intact", () => {
    const node = "labels/label:security/switch.patio_lights";
    const url = urlFor("/entity-explorer", { view: "labels", node, query: "", chips: [] });
    expect(readUrlState("/entity-explorer", at(url)).node).toBe(node);
  });

  it("ignores an unknown view and unknown filters", () => {
    expect(readUrlState("/entity-explorer", at("/entity-explorer/bogus?filter=nope,hide-hidden"))).toMatchObject({
      view: undefined,
      chips: ["hide-hidden"],
    });
  });

  it("reads the bare panel URL as no state", () => {
    expect(readUrlState("/entity-explorer", at("/entity-explorer"))).toEqual({
      view: undefined,
      entity: undefined,
      node: undefined,
      query: "",
      chips: [],
    });
  });
});
