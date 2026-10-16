import type { Config } from "./config.js";
import type { Plan } from "../../shared/types.js";
import {
  itineraryMapPoints,
  type BrowserMapConfig,
  type InteractiveMapData,
} from "../../shared/interactive-map.js";

// Explicit allowlist: the server-side Web Service Key must never reach the browser/export.
export function browserMapConfig(config: Config): BrowserMapConfig {
  return {
    key: config.amapJsKey || "",
    ...(config.amapJsSecurityCode
      ? { securityCode: config.amapJsSecurityCode }
      : {}),
  };
}
export function browserMapData(
  plan: Plan,
  config: Config,
  day = 0,
): InteractiveMapData {
  return {
    ...browserMapConfig(config),
    day,
    points: itineraryMapPoints(plan, day),
  };
}
