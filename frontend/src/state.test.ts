import { describe, expect, it } from "vitest";

import type { HassEntity } from "./hass";
import { isActive, isUpdateAvailable } from "./state";

const entity = (entity_id: string, state: string): HassEntity => ({
  entity_id,
  state,
  last_changed: "2026-10-28T00:00:00Z",
  attributes: {},
});

describe("state helpers", () => {
  it("treats a pending update as an update, not as activity", () => {
    const update = entity("update.firmware", "on");
    expect(isUpdateAvailable(update)).toBe(true);
    expect(isActive(update)).toBe(false);
  });

  it("treats an up-to-date update entity as neither", () => {
    const update = entity("update.firmware", "off");
    expect(isUpdateAvailable(update)).toBe(false);
    expect(isActive(update)).toBe(false);
  });

  it("treats on and heat as active", () => {
    expect(isActive(entity("light.kitchen", "on"))).toBe(true);
    expect(isActive(entity("climate.hall", "heat"))).toBe(true);
    expect(isActive(entity("light.kitchen", "off"))).toBe(false);
  });
});
