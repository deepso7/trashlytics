import type { AnalyticsDestination } from "./destination.js";

/**
 * @since 1.0.0
 * @category destinations
 */
export const consoleDestination: AnalyticsDestination = {
  name: "Console",
  track: (event) => {
    console.log(`[Analytics] Track: ${event.name}`, event.properties);
  },
  identify: (identify) => {
    console.log(`[Analytics] Identify: ${identify.userId}`, identify.traits);
  },
};
