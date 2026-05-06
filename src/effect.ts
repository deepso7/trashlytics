import {
  Duration,
  Effect,
  Fiber,
  Option,
  Queue,
  Schedule,
  Schema,
  Semaphore,
} from "effect";

type AnySchema = Schema.Decoder<unknown, never>;
type EventFields = Schema.Struct.Fields;

/**
 * Error returned when an event key is not present in a tracker's event registry.
 */
export class UnknownEventError extends Schema.TaggedErrorClass<UnknownEventError>()(
  "UnknownEventError",
  {
    key: Schema.String,
  }
) {}

/**
 * Error returned when a tracker operation is attempted after shutdown.
 */
export class TrackerShutdownError extends Schema.TaggedErrorClass<TrackerShutdownError>()(
  "TrackerShutdownError",
  {}
) {}

/**
 * Error returned when a queued event cannot be accepted because the buffer is full.
 */
export class BufferFullError extends Schema.TaggedErrorClass<BufferFullError>()(
  "BufferFullError",
  {
    size: Schema.Number,
  }
) {}

/**
 * Wraps failures raised while delivering a batch to a sink.
 */
export class SinkDeliveryError extends Schema.TaggedErrorClass<SinkDeliveryError>()(
  "SinkDeliveryError",
  {
    cause: Schema.Unknown,
  }
) {}

/**
 * Defines a trackable event name and the schema used to validate its payload.
 */
export interface EventDefinition<Name extends string, Payload> {
  readonly name: Name;
  readonly schema: Schema.Decoder<Payload, never>;
}

/**
 * Extracts the payload type from an {@link EventDefinition}.
 */
export type EventPayload<Definition> =
  Definition extends EventDefinition<string, infer Payload> ? Payload : never;

/**
 * Registry of event keys accepted by a tracker.
 */
export type EventsMap = Record<string, EventDefinition<string, unknown>>;

/**
 * Event object delivered to sinks after validation and timestamping.
 */
export type TrackedEvent<
  Events extends EventsMap,
  Key extends keyof Events & string = keyof Events & string,
> = {
  readonly [K in Key]: {
    readonly key: K;
    readonly name: Events[K]["name"];
    readonly payload: EventPayload<Events[K]>;
    readonly timestamp: number;
    readonly meta?: EventMeta;
  };
}[Key];

/**
 * Optional metadata attached to an individual tracked event.
 */
export type EventMeta = Record<string, unknown>;

/**
 * Effect-native sink that receives validated events in batches.
 */
export type Sink<
  Events extends EventsMap,
  Error = never,
  Requirements = never,
> = (
  batch: readonly TrackedEvent<Events>[]
) => Effect.Effect<void, Error, Requirements>;

/**
 * Retry configuration for failed sink deliveries.
 */
export interface RetryOptions {
  /** Number of retry attempts after the initial delivery attempt. */
  readonly attempts?: number;
  /** Initial retry delay in milliseconds. */
  readonly delay?: number;
  /** Exponential backoff multiplier. */
  readonly factor?: number;
}

/**
 * Configuration used to create an Effect-native tracker.
 */
export interface TrackerOptions<
  Events extends EventsMap,
  Error = never,
  Requirements = never,
> {
  /** Maximum number of events delivered in one sink call. Defaults to 20. */
  readonly batchSize?: number;
  /**
   * Maximum number of queued events before new events are dropped. Defaults to
   * 1000.
   */
  readonly bufferSize?: number;
  /** Event definitions accepted by this tracker. */
  readonly events: Events;
  /**
   * Automatic flush interval in milliseconds. Set to 0 to disable. Defaults to
   * 5000.
   */
  readonly flushInterval?: number;
  /** Called when background delivery fails. */
  readonly onError?: (error: unknown) => void;
  /** Retry policy for failed sink deliveries. */
  readonly retries?: number | RetryOptions;
  /** Destination for validated event batches. */
  readonly sink: Sink<Events, Error, Requirements>;
}

/**
 * Per-event options accepted by {@link Tracker.track} and {@link Tracker.trackNow}.
 */
export interface TrackOptions {
  /** Metadata copied onto the tracked event. */
  readonly meta?: EventMeta;
  /**
   * Event timestamp in milliseconds since the Unix epoch. Defaults to
   * `Date.now()`.
   */
  readonly timestamp?: number;
}

/**
 * Errors that can be raised while accepting an event for tracking.
 */
export type TrackError =
  | Schema.SchemaError
  | UnknownEventError
  | TrackerShutdownError
  | BufferFullError;

/**
 * Effect-native tracker for validating, queueing, and delivering typed events.
 */
export interface Tracker<
  Events extends EventsMap,
  Error = never,
  Requirements = never,
> {
  /** Delivers all currently queued events. */
  readonly flush: () => Effect.Effect<void, Error, Requirements>;
  /** Stops background flushing and delivers remaining queued events. */
  readonly shutdown: () => Effect.Effect<void, Error, Requirements>;
  /** Validates and queues an event for batched delivery. */
  readonly track: <Key extends keyof Events & string>(
    key: Key,
    payload: EventPayload<Events[Key]>,
    options?: TrackOptions
  ) => Effect.Effect<void, TrackError | Error, Requirements>;
  /** Validates an event and delivers it immediately without queueing. */
  readonly trackNow: <Key extends keyof Events & string>(
    key: Key,
    payload: EventPayload<Events[Key]>,
    options?: TrackOptions
  ) => Effect.Effect<
    void,
    Schema.SchemaError | UnknownEventError | TrackerShutdownError | Error,
    Requirements
  >;
}

type InferFields<Fields extends EventFields> = Schema.Schema.Type<
  Schema.Struct<Fields>
>;

/**
 * Creates a typed event definition from a public event name and struct fields.
 *
 * @param name - Public event name delivered to sinks.
 * @param fields - Struct fields used to validate and type the event payload.
 * @returns A typed event definition for use in a tracker event registry.
 */
export function event<
  const Name extends string,
  const Fields extends EventFields,
>(name: Name, fields: Fields): EventDefinition<Name, InferFields<Fields>>;
/**
 * Creates a typed event definition from a public event name and a schema.
 *
 * @param name - Public event name delivered to sinks.
 * @param schema - Schema used to validate and type the event payload.
 * @returns A typed event definition for use in a tracker event registry.
 */
export function event<
  const Name extends string,
  const EventSchema extends AnySchema,
>(
  name: Name,
  schema: EventSchema
): EventDefinition<Name, Schema.Schema.Type<EventSchema>>;
/**
 * Creates a typed event definition from a public event name and an Effect schema.
 *
 * The second argument may be either a full schema or `Schema.Struct` fields.
 *
 * @param name - Public event name delivered to sinks.
 * @param schemaOrFields - Full schema or struct fields used for payload validation.
 * @returns A typed event definition for use in a tracker event registry.
 */
export function event(name: string, schemaOrFields: AnySchema | EventFields) {
  return {
    name,
    schema: isSchema(schemaOrFields)
      ? schemaOrFields
      : Schema.Struct(schemaOrFields),
  };
}

/**
 * Creates an Effect-native tracker that validates event payloads before delivering
 * them to the configured sink.
 *
 * @param options - Tracker configuration, including event definitions and sink.
 * @returns A tracker whose operations return Effect values.
 */
export function createTracker<
  const Events extends EventsMap,
  Error = never,
  Requirements = never,
>(
  options: TrackerOptions<Events, Error, Requirements>
): Tracker<Events, Error, Requirements> {
  const batchSize = options.batchSize ?? 20;
  const bufferSize = options.bufferSize ?? 1000;
  const flushInterval = options.flushInterval ?? 5000;
  const retryOptions = normalizeRetries(options.retries);
  const queue = Effect.runSync(
    Queue.dropping<TrackedEvent<Events>>(bufferSize)
  );
  const flushSemaphore = Semaphore.makeUnsafe(1);
  const intervalSemaphore = Semaphore.makeUnsafe(1);
  let intervalFiber: Fiber.Fiber<never> | undefined;
  let closed = false;

  const stopFlushInterval = Effect.fn("trashlytics.stopFlushInterval")(
    function* () {
      yield* intervalSemaphore.withPermit(
        Effect.gen(function* () {
          if (intervalFiber !== undefined) {
            const fiber = intervalFiber;
            intervalFiber = undefined;
            yield* Fiber.interrupt(fiber);
          }
        })
      );
    }
  );

  const takeBatch = Effect.fn("trashlytics.takeBatch")(function* () {
    const batch: TrackedEvent<Events>[] = [];

    while (batch.length < batchSize) {
      const item = yield* Queue.poll(queue);

      if (Option.isNone(item)) {
        break;
      }

      batch.push(item.value);
    }

    return batch;
  });

  const drainQueue = Effect.fn("trashlytics.drainQueue")(function* () {
    yield* flushSemaphore.withPermit(
      Effect.uninterruptible(
        Effect.gen(function* () {
          while (true) {
            const batch = yield* takeBatch();

            if (batch.length === 0) {
              break;
            }

            yield* sendWithRetries(options.sink, batch, retryOptions);
          }
        })
      )
    );
  });

  const flush = Effect.fn("trashlytics.flush")(function* () {
    yield* drainQueue();
  });

  const ensureFlushInterval = Effect.fn("trashlytics.ensureFlushInterval")(
    function* () {
      yield* intervalSemaphore.withPermit(
        Effect.uninterruptible(
          Effect.gen(function* () {
            if (closed || flushInterval <= 0 || intervalFiber !== undefined) {
              return;
            }

            intervalFiber = yield* Effect.schedule(
              Effect.void,
              Schedule.duration(Duration.millis(flushInterval))
            ).pipe(
              Effect.andThen(drainQueue()),
              Effect.tapError((error) =>
                Effect.sync(() => {
                  options.onError?.(error);
                })
              ),
              Effect.ignore,
              Effect.forever,
              Effect.forkDetach
            );
          })
        )
      );
    }
  );

  const flushIfBatchSizeReached = Effect.fn(
    "trashlytics.flushIfBatchSizeReached"
  )(function* () {
    const queueSize = yield* Queue.size(queue);

    if (queueSize < batchSize) {
      return;
    }

    yield* drainQueue();
  });

  const makeEvent = <Key extends keyof Events & string>(
    key: Key,
    payload: EventPayload<Events[Key]>,
    trackOptions?: TrackOptions
  ) => {
    const definition = options.events[key];

    if (definition === undefined) {
      return Effect.fail(new UnknownEventError({ key }));
    }

    return Schema.decodeUnknownEffect(definition.schema)(payload).pipe(
      Effect.map(
        (decodedPayload): TrackedEvent<Events, Key> => ({
          key,
          name: definition.name,
          payload: decodedPayload as EventPayload<Events[Key]>,
          timestamp: trackOptions?.timestamp ?? Date.now(),
          ...(trackOptions?.meta === undefined
            ? {}
            : { meta: trackOptions.meta }),
        })
      )
    );
  };

  return {
    track: Effect.fn("trashlytics.track")(
      function* (key, payload, trackOptions) {
        if (closed) {
          return yield* new TrackerShutdownError();
        }

        const trackedEvent = yield* makeEvent(key, payload, trackOptions);
        const wasQueued = yield* Queue.offer(queue, trackedEvent);

        if (!wasQueued) {
          return yield* new BufferFullError({ size: bufferSize });
        }

        yield* ensureFlushInterval();
        yield* flushIfBatchSizeReached();
      }
    ),

    trackNow: Effect.fn("trashlytics.trackNow")(
      function* (key, payload, trackOptions) {
        if (closed) {
          return yield* new TrackerShutdownError();
        }

        const trackedEvent = yield* makeEvent(key, payload, trackOptions);

        yield* sendWithRetries(options.sink, [trackedEvent], retryOptions);
      }
    ),

    flush,

    shutdown: Effect.fn("trashlytics.shutdown")(function* () {
      closed = true;
      yield* stopFlushInterval();
      yield* flush();
    }),
  };
}

/**
 * Creates a sink that logs each delivered batch with `console.log`.
 *
 * @param log - Logger implementation to receive delivered batches.
 * @returns An Effect-native sink for tracker configuration.
 */
export function consoleSink<Events extends EventsMap>(
  log: Pick<Console, "log"> = console
): Sink<Events> {
  return (batch) =>
    Effect.sync(() => {
      log.log(batch);
    });
}

/**
 * Fetch options accepted by {@link httpSink}.
 */
export type HttpSinkOptions = Omit<RequestInit, "body" | "method"> & {
  /** HTTP method used to deliver batches. Defaults to `POST`. */
  readonly method?: "POST" | "PUT" | "PATCH";
};

/**
 * Creates a sink that posts JSON-encoded batches to an HTTP endpoint.
 *
 * @param url - HTTP endpoint that receives event batches.
 * @param options - Fetch options and optional delivery method.
 * @returns An Effect-native sink that fails with `SinkDeliveryError`.
 */
export function httpSink<Events extends EventsMap>(
  url: string | URL,
  options: HttpSinkOptions = {}
): Sink<Events, SinkDeliveryError> {
  return (batch) =>
    Effect.tryPromise({
      try: async () => {
        const headers = new Headers(options.headers);

        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }

        const response = await globalThis.fetch(url, {
          ...options,
          headers,
          method: options.method ?? "POST",
          body: Schema.encodeUnknownSync(Schema.UnknownFromJsonString)(batch),
        });

        if (!response.ok) {
          throw new Error(`HTTP sink failed with status ${response.status}`);
        }
      },
      catch: (cause) => new SinkDeliveryError({ cause }),
    });
}

/**
 * Delivers a batch through a sink using the provided retry policy.
 *
 * @param sink - Sink used to deliver the batch.
 * @param batch - Validated events to deliver.
 * @param retries - Expanded retry policy.
 * @returns An Effect that completes when delivery succeeds or retries are exhausted.
 */
export function sendWithRetries<Events extends EventsMap, Error, Requirements>(
  sink: Sink<Events, Error, Requirements>,
  batch: readonly TrackedEvent<Events>[],
  retries: Required<RetryOptions>
) {
  return Effect.retry(sink(batch), {
    times: retries.attempts,
    schedule: Schedule.exponential(
      Duration.millis(retries.delay),
      retries.factor
    ),
  });
}

/**
 * Expands shorthand retry configuration into explicit retry defaults.
 *
 * @param retries - Retry count, partial retry options, or undefined.
 * @returns Retry options with attempts, delay, and factor populated.
 */
export function normalizeRetries(retries: number | RetryOptions | undefined) {
  if (typeof retries === "number") {
    return { attempts: retries, delay: 250, factor: 2 };
  }

  return {
    attempts: retries?.attempts ?? 0,
    delay: retries?.delay ?? 250,
    factor: retries?.factor ?? 2,
  };
}

const isSchema = (value: unknown): value is AnySchema =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "ast" in value &&
  "rebuild" in value;
