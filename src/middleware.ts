/**
 * Middleware - simple function-based event transformations.
 *
 * @since 1.0.0
 */
import type { Event, EventMap, EventUnion } from "./event.js";

/**
 * Middleware function that transforms or filters events.
 * Return the transformed event, or null to filter it out.
 *
 * @template E - Event map type. Defaults to `EventMap` for reusable middleware.
 */
export type Middleware<E extends EventMap = EventMap> = (
  event: Event<EventUnion<E>>
) => Event<EventUnion<E>> | null;

/**
 * Identity middleware - passes events through unchanged.
 *
 * @example
 * ```ts
 * type MyEvents = { click: { x: number } }
 * const mw = identity<MyEvents>()
 * ```
 */
export const identity =
  <E extends EventMap = EventMap>(): Middleware<E> =>
  (event) =>
    event;

/**
 * Compose multiple middlewares into one.
 * Middlewares are applied left to right.
 * If any middleware returns null, the event is filtered out.
 *
 * @template E - Event map type. Defaults to `EventMap` for reusable middleware.
 *
 * @example
 * ```ts
 * type MyEvents = { click: { buttonId: string } }
 *
 * const middleware = compose<MyEvents>(
 *   addMetadata({ appVersion: "1.0.0" }),
 *   filter((e) => e.name !== "internal"),
 * )
 * ```
 */
export const compose = <E extends EventMap = EventMap>(
  ...middlewares: readonly Middleware<E>[]
): Middleware<E> => {
  if (middlewares.length === 0) {
    return identity<E>();
  }

  return (event) => {
    let current: Event<EventUnion<E>> | null = event;
    for (const mw of middlewares) {
      if (current === null) {
        return null;
      }
      current = mw(current);
    }
    return current;
  };
};

/**
 * Filter events based on a predicate.
 * Events that don't match the predicate are dropped.
 *
 * @template E - Event map type. Defaults to `EventMap` for reusable middleware.
 *
 * @example
 * ```ts
 * // Only track production events
 * const prodOnly = filter(() => process.env.NODE_ENV === "production")
 *
 * // Skip internal events
 * const skipInternal = filter((e) => !e.name.startsWith("_"))
 * ```
 */
export const filter = <E extends EventMap = EventMap>(
  predicate: (event: Event<EventUnion<E>>) => boolean
): Middleware<E> => {
  return (event) => (predicate(event) ? event : null);
};

/**
 * Add static metadata to events.
 *
 * @template E - Event map type. Defaults to `EventMap` for reusable middleware.
 *
 * @example
 * ```ts
 * const addVersion = addMetadata({
 *   appVersion: "1.0.0",
 *   environment: "production",
 * })
 * ```
 */
export const addMetadata = <E extends EventMap = EventMap>(
  metadata: Record<string, unknown>
): Middleware<E> => {
  return (event) => ({
    ...event,
    metadata: { ...event.metadata, ...metadata },
  });
};

/**
 * Add metadata dynamically based on the event.
 *
 * @template E - Event map type. Defaults to `EventMap` for reusable middleware.
 *
 * @example
 * ```ts
 * const addTimezone = addMetadataFrom(() => ({
 *   timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
 * }))
 * ```
 */
export const addMetadataFrom = <E extends EventMap = EventMap>(
  fn: (event: Event<EventUnion<E>>) => Record<string, unknown>
): Middleware<E> => {
  return (event) => ({
    ...event,
    metadata: { ...event.metadata, ...fn(event) },
  });
};

/**
 * Transform the event name.
 *
 * @template E - Event map type. Defaults to `EventMap` for reusable middleware.
 *
 * @example
 * ```ts
 * // Prefix all event names
 * const prefixed = mapName((name) => `app.${name}`)
 * ```
 */
export const mapName = <E extends EventMap = EventMap>(
  fn: (name: string) => string
): Middleware<E> => {
  return (event) => ({
    ...event,
    name: fn(event.name),
  });
};

/**
 * Transform the event payload.
 *
 * @template E - Event map type. Defaults to `EventMap` for reusable middleware.
 *
 * @example
 * ```ts
 * // Redact sensitive fields
 * const redact = mapPayload((payload) => ({
 *   ...payload,
 *   password: "[REDACTED]",
 * }))
 * ```
 */
export const mapPayload = <E extends EventMap = EventMap>(
  fn: (payload: EventUnion<E>) => EventUnion<E>
): Middleware<E> => {
  return (event) => ({
    ...event,
    payload: fn(event.payload),
  });
};

/**
 * Transform the entire event.
 *
 * @template E - Event map type. Defaults to `EventMap` for reusable middleware.
 *
 * @example
 * ```ts
 * const transform = map((event) => ({
 *   ...event,
 *   timestamp: Date.now(),
 * }))
 * ```
 */
export const map = <E extends EventMap = EventMap>(
  fn: (event: Event<EventUnion<E>>) => Event<EventUnion<E>>
): Middleware<E> => {
  return (event) => fn(event);
};

/**
 * Tap into the event stream for side effects.
 * Does not modify the event.
 *
 * @template E - Event map type. Defaults to `EventMap` for reusable middleware.
 *
 * @example
 * ```ts
 * const logger = tap((event) => console.log("Tracking:", event.name))
 * ```
 */
export const tap = <E extends EventMap = EventMap>(
  fn: (event: Event<EventUnion<E>>) => void
): Middleware<E> => {
  return (event) => {
    fn(event);
    return event;
  };
};
