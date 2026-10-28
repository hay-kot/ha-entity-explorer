import type { HassEntity } from "./hass";

// States that read as "doing something" across common domains. HA keeps the
// real per-domain rule internal, so this is an approximation for tinting.
const ACTIVE_STATES = new Set([
  "on",
  "open",
  "opening",
  "closing",
  "home",
  "playing",
  "heat",
  "cool",
  "heat_cool",
  "auto",
  "dry",
  "fan_only",
  "recording",
  "streaming",
  "active",
  "cleaning",
  "unlocked",
  "triggered",
]);

// An update entity is "on" when an update is available. That is not
// activity, and the tree marks it with its own icon.
export function isActive(stateObj: HassEntity | undefined): boolean {
  return Boolean(
    stateObj && ACTIVE_STATES.has(stateObj.state) && !stateObj.entity_id.startsWith("update."),
  );
}

export function isUpdateAvailable(stateObj: HassEntity | undefined): boolean {
  return Boolean(stateObj?.entity_id.startsWith("update.") && stateObj.state === "on");
}

export function isUnavailable(stateObj: HassEntity | undefined): boolean {
  return stateObj?.state === "unavailable";
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeTime(iso: string, language: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}
