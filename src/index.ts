/**
 * Trashlytics - A lightweight event tracking library.
 *
 * @example
 * ```ts
 * import { createTracker, TransportError } from "trashlytics"
 *
 * const tracker = createTracker({
 *   transports: [{
 *     name: "http",
 *     send: async (events) => {
 *       const response = await fetch("/analytics", {
 *         method: "POST",
 *         body: JSON.stringify(events),
 *       })
 *       if (!response.ok) {
 *         throw new TransportError({
 *           transport: "http",
 *           reason: `HTTP ${response.status}`,
 *           retryable: response.status >= 500,
 *         })
 *       }
 *     },
 *   }],
 *   batchSize: 10,
 *   flushIntervalMs: 5000,
 * })
 *
 * tracker.track("page_view", { page: "/home" })
 * tracker.track("button_click", { buttonId: "signup" })
 *
 * // Graceful shutdown
 * await tracker.shutdown()
 * ```
 *
 * @since 1.0.0
 */

// Config
export type { QueueStrategy, ResolvedConfig, TrackerConfig } from "./config.js";
export { defaults, resolveConfig } from "./config.js";
// Event
export type { Event, EventOptions } from "./event.js";
export { createEvent } from "./event.js";
// Logger
export type { Logger, LogLevel } from "./logger.js";
export { consoleLogger, createMinLevelLogger, noopLogger } from "./logger.js";

// Middleware
export type { Middleware } from "./middleware.js";
export {
  addMetadata,
  addMetadataFrom,
  compose,
  filter,
  identity,
  map,
  mapName,
  mapPayload,
  tap,
} from "./middleware.js";

// Tracker
export type { Tracker } from "./tracker.js";
export { createTracker } from "./tracker.js";

// Transport
export type { Transport } from "./transport.js";
export { TransportError } from "./transport.js";
