/**
 * Trashlytics - A generic, Effect-based event/analytics library.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Tracker, Transports, Transport, TransportError, Middleware } from "trashlytics"
 * import { Effect, Layer, Duration } from "effect"
 *
 * // 1. Create a transport
 * const httpTransport: Transport = {
 *   name: "http",
 *   send: (events) =>
 *     Effect.tryPromise({
 *       try: () => fetch("/analytics", {
 *         method: "POST",
 *         body: JSON.stringify(events),
 *       }),
 *       catch: (e) => new TransportError({
 *         transport: "http",
 *         reason: String(e),
 *         retryable: true,
 *       }),
 *     }).pipe(Effect.asVoid),
 * }
 *
 * // 2. Provide transports
 * const TransportsLive = Layer.succeed(Transports, [httpTransport])
 *
 * // 3. Create middleware (optional)
 * const middleware = Middleware.compose(
 *   Middleware.addMetadata({ appVersion: "1.0.0" }),
 *   Middleware.filter((e) => e.name !== "internal"),
 * )
 *
 * // 4. Create tracker layer
 * const TrackerLive = Tracker.make(
 *   { batchSize: 20, flushInterval: Duration.seconds(10) },
 *   middleware
 * ).pipe(Layer.provide(TransportsLive))
 *
 * // 5. Use it
 * const program = Effect.gen(function* () {
 *   const tracker = yield* Tracker
 *   yield* tracker.track("page_view", { page: "/home" })
 *   yield* tracker.track("button_click", { id: "signup" })
 *   yield* tracker.shutdown
 * })
 *
 * Effect.runPromise(program.pipe(Effect.provide(TrackerLive)))
 * ```
 */

// Config
export type { Config, QueueStrategy } from "./Config.js";
export {
  defaults as configDefaults,
  resolve as resolveConfig,
} from "./Config.js";

// Event
export type { Event, MakeOptions as EventMakeOptions } from "./Event.js";
export { make as makeEvent } from "./Event.js";

// Middleware
export type { Middleware } from "./Middleware.js";
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
} from "./Middleware.js";

// Tracker
export type { ITracker } from "./Tracker.js";
export { make as makeTracker, Tracker } from "./Tracker.js";

// Transport
export type { Transport } from "./Transport.js";
export { TransportError, Transports } from "./Transport.js";
