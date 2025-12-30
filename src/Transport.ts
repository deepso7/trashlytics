/**
 * Transport module - defines the transport interface for sending events.
 *
 * @since 1.0.0
 */
import { Context, Data, type Effect } from "effect";
import type { Event } from "./Event.js";

/**
 * Error that occurs during transport operations.
 *
 * @since 1.0.0
 */
export class TransportError extends Data.TaggedError("TransportError")<{
  readonly transport: string;
  readonly reason: string;
  readonly retryable: boolean;
}> {}

/**
 * Transport interface for sending events to a destination.
 * Users implement this interface for their specific destination.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Transport, TransportError } from "trashlytics"
 * import { Effect } from "effect"
 *
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
 * ```
 */
export interface Transport {
  readonly name: string;
  readonly send: (
    events: readonly Event[]
  ) => Effect.Effect<void, TransportError>;
}

/**
 * Service tag for providing multiple transports.
 * The tracker will fan-out events to all provided transports.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Transports } from "trashlytics"
 * import { Layer } from "effect"
 *
 * const TransportsLive = Layer.succeed(Transports, [
 *   httpTransport,
 *   consoleTransport,
 * ])
 * ```
 */
export class Transports extends Context.Tag("trashlytics/Transports")<
  Transports,
  readonly Transport[]
>() {}
