/**
 * Middleware - simple function-based event transformations.
 *
 * @since 1.0.0
 */
import type { Event } from "./event.js";

/**
 * Middleware function that transforms or filters events.
 * Return the transformed event, or null to filter it out.
 */
export type Middleware = (event: Event) => Event | null;

/**
 * Identity middleware - passes events through unchanged.
 */
export const identity: Middleware = (event) => event;

/**
 * Compose multiple middlewares into one.
 * Middlewares are applied left to right.
 * If any middleware returns null, the event is filtered out.
 *
 * @example
 * ```ts
 * const middleware = compose(
 *   addMetadata({ appVersion: "1.0.0" }),
 *   filter((e) => e.name !== "internal"),
 * )
 * ```
 */
export const compose = (...middlewares: readonly Middleware[]): Middleware => {
  if (middlewares.length === 0) {
    return identity;
  }

  return (event) => {
    let current: Event | null = event;
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
 * @example
 * ```ts
 * // Only track production events
 * const prodOnly = filter(() => process.env.NODE_ENV === "production")
 *
 * // Skip internal events
 * const skipInternal = filter((e) => !e.name.startsWith("_"))
 * ```
 */
export const filter = (predicate: (event: Event) => boolean): Middleware => {
  return (event) => (predicate(event) ? event : null);
};

/**
 * Add static metadata to events.
 *
 * @example
 * ```ts
 * const addVersion = addMetadata({
 *   appVersion: "1.0.0",
 *   environment: "production",
 * })
 * ```
 */
export const addMetadata = (metadata: Record<string, unknown>): Middleware => {
  return (event) => ({
    ...event,
    metadata: { ...event.metadata, ...metadata },
  });
};

/**
 * Add metadata dynamically based on the event.
 *
 * @example
 * ```ts
 * const addTimezone = addMetadataFrom(() => ({
 *   timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
 * }))
 * ```
 */
export const addMetadataFrom = (
  fn: (event: Event) => Record<string, unknown>
): Middleware => {
  return (event) => ({
    ...event,
    metadata: { ...event.metadata, ...fn(event) },
  });
};

/**
 * Transform the event name.
 *
 * @example
 * ```ts
 * // Prefix all event names
 * const prefixed = mapName((name) => `app.${name}`)
 * ```
 */
export const mapName = (fn: (name: string) => string): Middleware => {
  return (event) => ({
    ...event,
    name: fn(event.name),
  });
};

/**
 * Transform the event payload.
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
export const mapPayload = <T, U>(fn: (payload: T) => U): Middleware => {
  return (event) => ({
    ...event,
    payload: fn(event.payload as T),
  });
};

/**
 * Transform the entire event.
 *
 * @example
 * ```ts
 * const transform = map((event) => ({
 *   ...event,
 *   timestamp: Date.now(),
 * }))
 * ```
 */
export const map = (fn: (event: Event) => Event): Middleware => {
  return (event) => fn(event);
};

/**
 * Tap into the event stream for side effects.
 * Does not modify the event.
 *
 * @example
 * ```ts
 * const logger = tap((event) => console.log("Tracking:", event.name))
 * ```
 */
export const tap = (fn: (event: Event) => void): Middleware => {
  return (event) => {
    fn(event);
    return event;
  };
};
