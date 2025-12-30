/**
 * Middleware module - ordered, composable event transformations.
 *
 * @since 1.0.0
 */
import { Effect, Option } from "effect";
import type { Event } from "./Event.js";

/**
 * Internal event wrapper that can be filtered out.
 */
type MaybeEvent = Option.Option<Event>;

/**
 * Middleware transforms events in the pipeline.
 * Middlewares are executed in order (left to right when composed).
 *
 * @since 1.0.0
 */
export interface Middleware {
  readonly name: string;
  readonly transform: (event: Event) => Effect.Effect<MaybeEvent, never>;
}

/**
 * Identity middleware that passes events through unchanged.
 *
 * @since 1.0.0
 */
export const identity: Middleware = {
  name: "identity",
  transform: (event) => Effect.succeed(Option.some(event)),
};

/**
 * Compose multiple middlewares into one.
 * Middlewares are applied left to right.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Middleware } from "trashlytics"
 *
 * const combined = Middleware.compose(
 *   Middleware.addMetadata({ appVersion: "1.0.0" }),
 *   Middleware.filter((e) => e.name !== "internal"),
 * )
 * ```
 */
export const compose = (...middlewares: readonly Middleware[]): Middleware => {
  if (middlewares.length === 0) {
    return identity;
  }

  return {
    name: `composed(${middlewares.map((m) => m.name).join(", ")})`,
    transform: (event) =>
      middlewares.reduce<Effect.Effect<MaybeEvent, never>>(
        (eff, mw) =>
          eff.pipe(
            Effect.flatMap((maybeEvent) =>
              Option.match(maybeEvent, {
                onNone: () => Effect.succeed(Option.none()),
                onSome: (e) => mw.transform(e),
              })
            )
          ),
        Effect.succeed(Option.some(event))
      ),
  };
};

/**
 * Filter events based on a predicate.
 * Events that don't match the predicate are dropped.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Middleware } from "trashlytics"
 *
 * // Only track events that aren't internal
 * const filterInternal = Middleware.filter((e) => !e.name.startsWith("_"))
 * ```
 */
export const filter = (predicate: (event: Event) => boolean): Middleware => ({
  name: "filter",
  transform: (event) =>
    Effect.succeed(predicate(event) ? Option.some(event) : Option.none()),
});

/**
 * Add or merge metadata to events.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Middleware } from "trashlytics"
 *
 * const addVersion = Middleware.addMetadata({
 *   appVersion: "1.0.0",
 *   environment: "production",
 * })
 * ```
 */
export const addMetadata = (metadata: Record<string, unknown>): Middleware => ({
  name: "addMetadata",
  transform: (event) =>
    Effect.succeed(
      Option.some({
        ...event,
        metadata: { ...event.metadata, ...metadata },
      })
    ),
});

/**
 * Add metadata dynamically based on the event.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Middleware } from "trashlytics"
 *
 * const addTimezone = Middleware.addMetadataFrom((event) => ({
 *   timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
 * }))
 * ```
 */
export const addMetadataFrom = (
  fn: (event: Event) => Record<string, unknown>
): Middleware => ({
  name: "addMetadataFrom",
  transform: (event) =>
    Effect.succeed(
      Option.some({
        ...event,
        metadata: { ...event.metadata, ...fn(event) },
      })
    ),
});

/**
 * Transform the event name.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Middleware } from "trashlytics"
 *
 * // Prefix all event names
 * const prefixed = Middleware.mapName((name) => `app.${name}`)
 * ```
 */
export const mapName = (fn: (name: string) => string): Middleware => ({
  name: "mapName",
  transform: (event) =>
    Effect.succeed(
      Option.some({
        ...event,
        name: fn(event.name),
      })
    ),
});

/**
 * Transform the event payload.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Middleware } from "trashlytics"
 *
 * // Redact sensitive fields
 * const redact = Middleware.mapPayload((payload) => ({
 *   ...payload,
 *   password: "[REDACTED]",
 * }))
 * ```
 */
export const mapPayload = <T, U>(fn: (payload: T) => U): Middleware => ({
  name: "mapPayload",
  transform: (event) =>
    Effect.succeed(
      Option.some({
        ...event,
        payload: fn(event.payload as T),
      })
    ),
});

/**
 * Transform the entire event.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Middleware } from "trashlytics"
 *
 * const transform = Middleware.map((event) => ({
 *   ...event,
 *   timestamp: Date.now(), // Override timestamp
 * }))
 * ```
 */
export const map = (fn: (event: Event) => Event): Middleware => ({
  name: "map",
  transform: (event) => Effect.succeed(Option.some(fn(event))),
});

/**
 * Tap into the event stream without modifying events.
 * Useful for logging or side effects.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Middleware } from "trashlytics"
 *
 * const logger = Middleware.tap((event) => {
 *   console.log("Tracking:", event.name)
 * })
 * ```
 */
export const tap = (fn: (event: Event) => void): Middleware => ({
  name: "tap",
  transform: (event) =>
    Effect.sync(() => {
      fn(event);
      return Option.some(event);
    }),
});
