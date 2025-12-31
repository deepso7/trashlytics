/**
 * Tracker - main entry point with vanilla JS API.
 * Uses Effect internally for batching, retry, and queue management.
 *
 * @since 1.0.0
 */
import { Duration, Effect, Exit, Fiber, Queue, Schedule, Scope } from "effect";
import type { QueueStrategy, ResolvedConfig, TrackerConfig } from "./config.js";
import { resolveConfig } from "./config.js";
import type { Event, EventMap, EventUnion } from "./event.js";
import { createEvent } from "./event.js";
import { generateId as defaultGenerateId } from "./internal/id.js";
import type { Middleware } from "./middleware.js";
import { identity } from "./middleware.js";
import type { Transport } from "./transport.js";
import { TransportError } from "./transport.js";

/**
 * Tracker interface - the main public API.
 *
 * @template E - Event map type for typed events.
 */
export interface Tracker<E extends EventMap> {
  /**
   * Track an event (fire-and-forget).
   * The event is queued and will be sent in the next batch.
   */
  track<K extends keyof E & string>(name: K, payload: E[K]): void;

  /**
   * Track an event and wait for it to be queued.
   */
  trackAsync<K extends keyof E & string>(name: K, payload: E[K]): Promise<void>;

  /**
   * Track an event with additional metadata.
   */
  trackWith<K extends keyof E & string>(
    name: K,
    payload: E[K],
    metadata: Record<string, unknown>
  ): void;

  /**
   * Flush all queued events immediately.
   * Waits for all retries to complete.
   */
  flush(): Promise<void>;

  /**
   * Gracefully shutdown the tracker.
   * Flushes remaining events and stops the background fiber.
   */
  shutdown(): Promise<void>;
}

/**
 * Create a new tracker instance.
 *
 * @template E - Event map type for typed events.
 *
 * @example
 * ```ts
 * type MyEvents = {
 *   page_view: { page: string; referrer?: string }
 *   button_click: { buttonId: string; label: string }
 *   purchase: { productId: string; amount: number }
 * }
 *
 * const tracker = createTracker<MyEvents>({
 *   transports: [httpTransport],
 *   batchSize: 10,
 *   flushIntervalMs: 5000,
 * })
 *
 * // Type-safe: name and payload are checked
 * tracker.track("page_view", { page: "/home" }) // OK
 * tracker.track("page_view", { wrong: "field" }) // Type error
 * tracker.track("unknown_event", {}) // Type error
 *
 * // Later...
 * await tracker.shutdown()
 * ```
 */
export const createTracker = <E extends EventMap>(
  config: TrackerConfig<E>,
  middleware?: Middleware<E>
): Tracker<E> => {
  const resolved = resolveConfig(config);
  const mw = middleware ?? identity<E>();
  const generateId = config.generateId ?? defaultGenerateId;
  const globalMetadata = config.metadata ?? {};

  // Internal state managed by Effect runtime
  let runtime: TrackerRuntime<E> | null = null;
  let isShutdown = false;

  const ensureRuntime = (): TrackerRuntime<E> => {
    if (isShutdown) {
      throw new Error("Tracker has been shut down");
    }
    if (!runtime) {
      runtime = createRuntime<E>(resolved, generateId, globalMetadata);
    }
    return runtime;
  };

  return {
    track: (name, payload) => {
      const rt = ensureRuntime();
      const event = createEvent(name, payload, {
        id: generateId(),
        metadata: { ...globalMetadata },
      });
      const transformed = mw(event as Event<EventUnion<E>>);
      if (transformed) {
        rt.offer(transformed);
      }
    },

    trackAsync: async (name, payload) => {
      const rt = ensureRuntime();
      const event = createEvent(name, payload, {
        id: generateId(),
        metadata: { ...globalMetadata },
      });
      const transformed = mw(event as Event<EventUnion<E>>);
      if (transformed) {
        await rt.offerAsync(transformed);
      }
    },

    trackWith: (name, payload, metadata) => {
      const rt = ensureRuntime();
      const event = createEvent(name, payload, {
        id: generateId(),
        metadata: { ...globalMetadata, ...metadata },
      });
      const transformed = mw(event as Event<EventUnion<E>>);
      if (transformed) {
        rt.offer(transformed);
      }
    },

    flush: async () => {
      if (!runtime || isShutdown) {
        return;
      }
      await runtime.flush();
    },

    shutdown: async () => {
      if (isShutdown) {
        return;
      }
      isShutdown = true;
      if (runtime) {
        await runtime.shutdown();
        runtime = null;
      }
    },
  };
};

// Internal runtime implementation using Effect
interface TrackerRuntime<E extends EventMap> {
  offer(event: Event<EventUnion<E>>): void;
  offerAsync(event: Event<EventUnion<E>>): Promise<void>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

const createRuntime = <E extends EventMap>(
  config: ResolvedConfig<E>,
  _generateId: () => string,
  _globalMetadata: Record<string, unknown>
): TrackerRuntime<E> => {
  // Create the Effect-based queue
  const queueEffect = createQueue<E>(
    config.queueCapacity,
    config.queueStrategy
  );
  const scope = Effect.runSync(Scope.make());
  const queue = Effect.runSync(queueEffect);

  // Retry schedule with exponential backoff and jitter
  const retrySchedule = Schedule.exponential(
    Duration.millis(config.retryDelayMs)
  ).pipe(
    Schedule.jittered,
    Schedule.compose(Schedule.recurs(config.retryAttempts))
  );

  // Dispatch function
  const dispatch = async (
    events: readonly Event<EventUnion<E>>[]
  ): Promise<void> => {
    if (events.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      config.transports.map((transport) =>
        dispatchToTransport(transport, events, retrySchedule)
      )
    );

    // Handle failures
    for (const result of results) {
      if (result.status === "rejected") {
        const error = result.reason as TransportError;
        if (config.onError) {
          config.onError(error, events);
        }
        config.logger.error("Transport failed:", error.message);
      }
    }
  };

  // Start background batch loop
  const batchLoop = Effect.gen(function* () {
    yield* Effect.forever(
      Effect.gen(function* () {
        const events = yield* Effect.race(
          Queue.takeBetween(queue, config.batchSize, config.batchSize),
          Effect.sleep(Duration.millis(config.flushIntervalMs)).pipe(
            Effect.zipRight(Queue.takeUpTo(queue, config.batchSize))
          )
        );

        if (events.length > 0) {
          yield* Effect.tryPromise({
            try: () => dispatch([...events]),
            catch: () => new Error("Dispatch failed"),
          }).pipe(Effect.catchAll(() => Effect.void));
        }
      })
    );
  });

  const batchFiber = Effect.runFork(
    batchLoop.pipe(Effect.provideService(Scope.Scope, scope))
  );

  return {
    offer: (event) => {
      Effect.runFork(Queue.offer(queue, event));
    },

    offerAsync: (event) =>
      Effect.runPromise(Queue.offer(queue, event)).then(() => undefined),

    flush: async () => {
      const events = await Effect.runPromise(Queue.takeAll(queue));
      if (events.length > 0) {
        await dispatch([...events]);
      }
    },

    shutdown: async () => {
      // Interrupt the batch loop
      await Effect.runPromise(Fiber.interrupt(batchFiber));

      // Flush remaining events
      const events = await Effect.runPromise(Queue.takeAll(queue));
      if (events.length > 0) {
        await dispatch([...events]);
      }

      // Close scope
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
};

// Create queue based on strategy
const createQueue = <E extends EventMap>(
  capacity: number,
  strategy: QueueStrategy
) => {
  switch (strategy) {
    case "bounded":
      return Queue.bounded<Event<EventUnion<E>>>(capacity);
    case "dropping":
      return Queue.dropping<Event<EventUnion<E>>>(capacity);
    case "sliding":
      return Queue.sliding<Event<EventUnion<E>>>(capacity);
    default:
      return Queue.dropping<Event<EventUnion<E>>>(capacity);
  }
};

// Dispatch to a single transport with retry
const dispatchToTransport = async <E extends EventMap>(
  transport: Transport<E>,
  events: readonly Event<EventUnion<E>>[],
  retrySchedule: Schedule.Schedule<unknown, unknown>
): Promise<void> => {
  const effect = Effect.tryPromise({
    try: () => transport.send(events),
    catch: (error) => {
      if (error instanceof TransportError) {
        return error;
      }
      return new TransportError({
        transport: transport.name,
        reason: String(error),
        retryable: true,
      });
    },
  }).pipe(
    Effect.retry({
      schedule: retrySchedule,
      while: (err) => err.retryable,
    })
  );

  await Effect.runPromise(effect);
};
