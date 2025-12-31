/**
 * Transport types - Promise-based interface for sending events.
 *
 * @since 1.0.0
 */
import type { Event, EventMap, EventUnion } from "./event.js";

/**
 * Error thrown when a transport fails to send events.
 */
export class TransportError extends Error {
  override readonly name = "TransportError";
  readonly transport: string;
  readonly retryable: boolean;

  constructor(options: {
    transport: string;
    reason: string;
    retryable: boolean;
  }) {
    super(options.reason);
    this.transport = options.transport;
    this.retryable = options.retryable;
  }
}

/**
 * Transport interface for sending events to a destination.
 *
 * @template E - Event map type. Defaults to `EventMap` for reusable transports.
 *
 * @example
 * ```ts
 * // Reusable transport (accepts any events)
 * const httpTransport: Transport = {
 *   name: "http",
 *   send: async (events) => {
 *     const response = await fetch("/analytics", {
 *       method: "POST",
 *       body: JSON.stringify(events),
 *     })
 *     if (!response.ok) {
 *       throw new TransportError({
 *         transport: "http",
 *         reason: `HTTP ${response.status}`,
 *         retryable: response.status >= 500,
 *       })
 *     }
 *   },
 * }
 *
 * // Typed transport (strict type checking)
 * type MyEvents = {
 *   page_view: { page: string }
 *   click: { buttonId: string }
 * }
 *
 * const typedTransport: Transport<MyEvents> = {
 *   name: "typed-http",
 *   send: async (events) => {
 *     // events are typed as Event<MyEvents[keyof MyEvents]>[]
 *     await fetch("/analytics", { method: "POST", body: JSON.stringify(events) })
 *   },
 * }
 * ```
 */
export interface Transport<E extends EventMap = EventMap> {
  /** Name of the transport (for debugging/logging) */
  readonly name: string;
  /** Send a batch of events. Throw TransportError on failure. */
  send(events: readonly Event<EventUnion<E>>[]): Promise<void>;
}
