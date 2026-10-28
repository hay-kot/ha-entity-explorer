import type { HomeAssistant } from "./hass";
import { entityDomain } from "./tree/build";

// HA picks state-aware icons through its internal ha-state-icon element, which
// the panel avoids. This static map covers the common domains instead.
const DOMAIN_ICONS: Record<string, string> = {
  alarm_control_panel: "mdi:shield-home",
  automation: "mdi:robot",
  binary_sensor: "mdi:checkbox-blank-circle-outline",
  button: "mdi:button-pointer",
  calendar: "mdi:calendar",
  camera: "mdi:video",
  climate: "mdi:thermostat",
  conversation: "mdi:forum-outline",
  cover: "mdi:window-shutter",
  device_tracker: "mdi:account",
  event: "mdi:eye-check",
  fan: "mdi:fan",
  group: "mdi:google-circles-communities",
  humidifier: "mdi:air-humidifier",
  image: "mdi:image",
  input_boolean: "mdi:toggle-switch-outline",
  input_button: "mdi:button-pointer",
  input_datetime: "mdi:calendar-clock",
  input_number: "mdi:ray-vertex",
  input_select: "mdi:format-list-bulleted",
  input_text: "mdi:form-textbox",
  light: "mdi:lightbulb",
  lock: "mdi:lock",
  media_player: "mdi:cast",
  number: "mdi:ray-vertex",
  person: "mdi:account",
  remote: "mdi:remote",
  scene: "mdi:palette",
  script: "mdi:script-text",
  select: "mdi:format-list-bulleted",
  sensor: "mdi:eye",
  siren: "mdi:bullhorn",
  stt: "mdi:microphone-message",
  sun: "mdi:white-balance-sunny",
  switch: "mdi:toggle-switch-variant",
  text: "mdi:form-textbox",
  timer: "mdi:timer-outline",
  todo: "mdi:clipboard-list",
  tts: "mdi:speaker-message",
  update: "mdi:package-up",
  vacuum: "mdi:robot-vacuum",
  valve: "mdi:valve",
  water_heater: "mdi:thermometer",
  weather: "mdi:weather-partly-cloudy",
  zone: "mdi:map-marker-radius",
};

export function domainIcon(domain: string): string {
  return DOMAIN_ICONS[domain] ?? "mdi:bookmark";
}

export function entityIcon(hass: HomeAssistant, entityId: string): string {
  return (
    hass.entities[entityId]?.icon ??
    hass.states[entityId]?.attributes.icon ??
    domainIcon(entityDomain(entityId))
  );
}
