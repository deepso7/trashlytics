/**
 * Tracker module - main entry point for tracking events.
 *
 * @since 1.0.0
 */
import {
  Context,
  type Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  type Scope,
} from "effect";
import type { Config } from "./Config.js";
import { resolve } from "./Config.js";
import { make as makeDispatcher } from "./Dispatcher.js";
import type { Event } from "./Event.js";
import { make as makeEvent } from "./Event.js";
import { generateId as defaultGenerateId } from "./internal/id.js";
import type { Middleware } from "./Middleware.js";
import { identity } from "./Middleware.js";
import type { IEventQueue } from "./Queue.js";
import { make as makeQueue } from "./Queue.js";
import type { TransportError, Transports } from "./Transport.js";

/**
 * Tracker service interface.
 *
 * @since 1.0.0
 */
export interface ITracker {
  /**
   * Track an event with the given name and payload.
   * This is fire-and-forget - the event is queued for later dispatch.
   */
  readonly track: <T>(name: string, payload: T) => Effect.Effect<void, never>;

  /**
   * Track an event with additional metadata.
   * Metadata is merged with global metadata from config.
   */
  readonly trackWith: <T>(
    name: string,
    payload: T,
    metadata: Record<string, unknown>
  ) => Effect.Effect<void, never>;

  /**
   * Flush all queued events immediately.
   * Waits for all retries to complete.
   */
  readonly flush: Effect.Effect<void, TransportError>;

  /**
   * Gracefully shutdown the tracker.
   * Flushes remaining events and stops the background fiber.
   */
  readonly shutdown: Effect.Effect<void, TransportError>;
}

/**
 * Service tag for the tracker.
 *
 * @since 1.0.0
 */
export class Tracker extends Context.Tag("trashlytics/Tracker")<
  Tracker,
  ITracker
>() {}

/**
 * Create a tracker layer with the given configuration and middleware.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Tracker, Transports } from "trashlytics"
 * import { Effect, Layer } from "effect"
 *
 * const TrackerLive = Tracker.make({
 *   batchSize: 20,
 *   flushInterval: Duration.seconds(10),
 * }).pipe(Layer.provide(TransportsLive))
 *
 * const program = Effect.gen(function* () {
 *   const tracker = yield* Tracker
 *   yield* tracker.track("page_view", { page: "/home" })
 * })
 * ```
 */
export const make = (
  config?: Config,
  middleware?: Middleware
): Layer.Layer<Tracker, never, Transports> =>
  Layer.scoped(
    Tracker,
    Effect.gen(function* () {
      const resolved = resolve(config);
      const mw = middleware ?? identity;
      const generateId = config?.generateId ?? defaultGenerateId;
      const globalMetadata = config?.metadata ?? {};

      // Create queue
      const queue = yield* makeQueue(
        resolved.queueCapacity,
        resolved.queueStrategy
      );

      // Create dispatcher
      const dispatcher = yield* makeDispatcher(resolved);

      // Start background batch loop
      const batchFiber = yield* startBatchLoop(
        queue,
        dispatcher.dispatch,
        resolved.batchSize,
        resolved.flushInterval
      ).pipe(Effect.forkScoped);

      // Create event from input
      const createEvent = <T>(
        name: string,
        payload: T,
        extraMetadata?: Record<string, unknown>
      ) =>
        makeEvent(name, payload, {
          id: generateId(),
          metadata: { ...globalMetadata, ...extraMetadata },
        });

      // Process event through middleware and queue
      const processEvent = (event: Event) =>
        mw.transform(event).pipe(
          Effect.flatMap((maybeEvent) =>
            Option.match(maybeEvent, {
              onNone: () => Effect.void,
              onSome: (e) => queue.offer(e).pipe(Effect.asVoid),
            })
          )
        );

      // Flush implementation
      const flushAll = Effect.gen(function* () {
        const events = yield* queue.takeAll;
        if (events.length > 0) {
          yield* dispatcher.dispatch(events);
        }
      });

      // Shutdown implementation
      const shutdownTracker = Effect.gen(function* () {
        // Interrupt the batch loop
        yield* Fiber.interrupt(batchFiber);

        // Flush remaining events with timeout
        yield* flushAll.pipe(
          Effect.timeout(resolved.shutdownTimeout),
          Effect.catchAll(() => Effect.void)
        );

        // Shutdown queue
        yield* queue.shutdown;
      });

      return {
        track: (name, payload) => processEvent(createEvent(name, payload)),

        trackWith: (name, payload, metadata) =>
          processEvent(createEvent(name, payload, metadata)),

        flush: flushAll,

        shutdown: shutdownTracker,
      };
    })
  );

/**
 * Background fiber that batches events and dispatches them.
 */
const startBatchLoop = (
  queue: IEventQueue,
  dispatch: (events: readonly Event[]) => Effect.Effect<void, TransportError>,
  batchSize: number,
  flushInterval: Duration.Duration
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* Effect.forever(
      Effect.gen(function* () {
        // Race between batch size and flush interval
        const events = yield* Effect.race(
          // Wait for full batch
          queue.takeBetween(batchSize, batchSize),
          // Or timeout and take whatever is available
          Effect.sleep(flushInterval).pipe(
            Effect.zipRight(queue.takeUpTo(batchSize))
          )
        );

        if (events.length > 0) {
          // Dispatch and ignore errors (they're already logged)
          yield* dispatch(events).pipe(Effect.catchAll(() => Effect.void));
        }
      })
    );
  });

// Re-export for convenience
export { Tracker as TrackerTag };
