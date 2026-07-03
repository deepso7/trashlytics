import {
  Cause,
  Data,
  Duration,
  Effect,
  Latch,
  Option,
  Queue,
  Schedule,
  Schema,
  type Scope,
  Semaphore,
} from "effect";

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

/**
 * Minimal Standard Schema v1 interface (https://standardschema.dev).
 *
 * Any spec-compliant validator (zod, valibot, arktype, ...) is accepted as an
 * event payload schema, in addition to Effect schemas.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
  };
}

/**
 * Result returned by a Standard Schema `validate` call.
 */
export type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardIssue[] };

/**
 * Issue reported by a Standard Schema `validate` call.
 */
export interface StandardIssue {
  readonly message: string;
  readonly path?:
    | readonly (PropertyKey | { readonly key: PropertyKey })[]
    | undefined;
}

type AnyEffectSchema = Schema.ConstraintDecoder<unknown, never>;
type EventFields = Schema.Struct.Fields;

/**
 * Any schema accepted as an event payload validator.
 */
export type PayloadSchema = AnyEffectSchema | StandardSchemaV1;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 * A single normalized validation issue.
 */
export interface ValidationIssue {
  readonly message: string;
  readonly path?: readonly PropertyKey[] | undefined;
}

/**
 * Error returned when an event payload fails schema validation.
 */
export class EventValidationError extends Data.TaggedError(
  "EventValidationError"
)<{
  readonly key: string;
  readonly issues: readonly ValidationIssue[];
  readonly cause?: unknown;
}> {
  override get message() {
    return `Invalid payload for event "${this.key}": ${this.issues
      .map((issue) => issue.message)
      .join("; ")}`;
  }
}

/**
 * Error returned when an event key is not present in a tracker's event registry.
 */
export class UnknownEventError extends Data.TaggedError("UnknownEventError")<{
  readonly key: string;
}> {
  override get message() {
    return `Unknown event "${this.key}"`;
  }
}

/**
 * Error returned when a tracker operation is attempted after the tracker's
 * scope has been closed.
 */
export class TrackerClosedError extends Data.TaggedError("TrackerClosedError") {
  override get message() {
    return "Tracker has been closed";
  }
}

/**
 * Error returned when a queued event cannot be accepted because the queue is
 * at capacity.
 */
export class QueueFullError extends Data.TaggedError("QueueFullError")<{
  readonly capacity: number;
}> {
  override get message() {
    return `Event queue is full (capacity ${this.capacity})`;
  }
}

/**
 * Wraps failures raised while delivering a batch to a sink.
 */
export class SinkError extends Data.TaggedError("SinkError")<{
  readonly cause: unknown;
}> {}

/**
 * Errors that can be raised while accepting an event for tracking.
 */
export type TrackError =
  | EventValidationError
  | UnknownEventError
  | TrackerClosedError
  | QueueFullError;

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

/**
 * Defines a trackable event: its public name and the schema used to validate
 * its payload. Created with {@link event}.
 */
export interface EventDefinition<Name extends string, Payload> {
  readonly _payload?: Payload;
  readonly name: Name;
  readonly schema: PayloadSchema | undefined;
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
 * Optional metadata attached to a tracked event.
 */
export type EventMeta = Record<string, unknown>;

/**
 * Event object delivered to sinks after validation and timestamping.
 *
 * The union is discriminated by `key`, so narrowing on `key` narrows
 * `name` and `payload` accordingly.
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

type InferFields<Fields extends EventFields> = Schema.Schema.Type<
  Schema.Struct<Fields>
>;

type StandardOutput<S extends StandardSchemaV1> =
  S extends StandardSchemaV1<infer _Input, infer Output> ? Output : never;

/**
 * Creates a payload-less event definition.
 *
 * @param name - Public event name delivered to sinks.
 */
export function event<const Name extends string>(
  name: Name
): EventDefinition<Name, void>;
/**
 * Creates a typed event definition from `Schema.Struct` fields.
 *
 * @param name - Public event name delivered to sinks.
 * @param fields - Struct fields used to validate and type the event payload.
 */
export function event<
  const Name extends string,
  const Fields extends EventFields,
>(name: Name, fields: Fields): EventDefinition<Name, InferFields<Fields>>;
/**
 * Creates a typed event definition from an Effect schema.
 *
 * @param name - Public event name delivered to sinks.
 * @param schema - Effect schema used to validate and type the event payload.
 */
export function event<
  const Name extends string,
  const EventSchema extends AnyEffectSchema,
>(
  name: Name,
  schema: EventSchema
): EventDefinition<Name, Schema.Schema.Type<EventSchema>>;
/**
 * Creates a typed event definition from any Standard Schema v1 validator
 * (zod, valibot, arktype, ...).
 *
 * @param name - Public event name delivered to sinks.
 * @param schema - Standard Schema used to validate and type the event payload.
 */
export function event<
  const Name extends string,
  const EventSchema extends StandardSchemaV1,
>(
  name: Name,
  schema: EventSchema
): EventDefinition<Name, StandardOutput<EventSchema>>;
export function event(
  name: string,
  schemaOrFields?: PayloadSchema | EventFields
) {
  if (schemaOrFields === undefined) {
    return { name, schema: undefined };
  }

  if (isEffectSchema(schemaOrFields) || isStandardSchema(schemaOrFields)) {
    return { name, schema: schemaOrFields };
  }

  return { name, schema: Schema.Struct(schemaOrFields) };
}

// -----------------------------------------------------------------------------
// Sinks
// -----------------------------------------------------------------------------

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
 * Creates a sink that logs each delivered batch.
 *
 * @param log - Logger implementation to receive delivered batches.
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
  /** Custom fetch implementation. Defaults to `globalThis.fetch`. */
  readonly fetch?: typeof globalThis.fetch;
};

/**
 * Creates a sink that posts JSON-encoded batches to an HTTP endpoint.
 *
 * `keepalive` defaults to `true` so in-flight batches survive page unloads in
 * browsers. Note that browsers cap keepalive request bodies at ~64KB.
 *
 * @param url - HTTP endpoint that receives event batches.
 * @param options - Fetch options and optional delivery method.
 */
export function httpSink<Events extends EventsMap>(
  url: string | URL,
  options: HttpSinkOptions = {}
): Sink<Events, SinkError> {
  const { fetch: fetchImpl, method, ...init } = options;

  return (batch) =>
    Effect.tryPromise({
      try: async () => {
        const headers = new Headers(init.headers);

        if (!headers.has("content-type")) {
          headers.set("content-type", "application/json");
        }

        const response = await (fetchImpl ?? globalThis.fetch)(url, {
          keepalive: true,
          ...init,
          headers,
          method: method ?? "POST",
          body: JSON.stringify(batch),
        });

        if (!response.ok) {
          throw new Error(`HTTP sink failed with status ${response.status}`);
        }
      },
      catch: (cause) => new SinkError({ cause }),
    });
}

/**
 * Creates a sink that delivers batches with `navigator.sendBeacon`.
 *
 * Beacon requests survive page unloads, making this a good fit for
 * browser-side trackers. Fails with {@link SinkError} outside browsers or when
 * the user agent refuses to queue the payload.
 *
 * @param url - HTTP endpoint that receives event batches.
 */
export function beaconSink<Events extends EventsMap>(
  url: string | URL
): Sink<Events, SinkError> {
  return (batch) =>
    Effect.try({
      try: () => {
        if (typeof navigator === "undefined" || !navigator.sendBeacon) {
          throw new Error("navigator.sendBeacon is not available");
        }

        const body = new Blob([JSON.stringify(batch)], {
          type: "application/json",
        });

        if (!navigator.sendBeacon(url, body)) {
          throw new Error("navigator.sendBeacon refused the payload");
        }
      },
      catch: (cause) => new SinkError({ cause }),
    });
}

// -----------------------------------------------------------------------------
// Tracker
// -----------------------------------------------------------------------------

/**
 * Retry policy for failed sink deliveries.
 */
export interface RetryPolicy {
  /** Number of retry attempts after the initial delivery attempt. */
  readonly attempts?: number;
  /** Initial retry delay in milliseconds. Defaults to 250. */
  readonly delay?: number;
  /** Exponential backoff multiplier. Defaults to 2. */
  readonly factor?: number;
  /** Applies random jitter to retry delays. Defaults to false. */
  readonly jitter?: boolean;
}

/**
 * Configuration used to create a tracker.
 */
export interface TrackerOptions<
  Events extends EventsMap,
  Error = never,
  Requirements = never,
> {
  /** Maximum number of events delivered in one sink call. Defaults to 20. */
  readonly batchSize?: number;
  /**
   * Static or lazily computed metadata merged into every event's `meta`.
   * Per-event metadata wins on key conflicts.
   */
  readonly context?: EventMeta | (() => EventMeta);
  /** Event definitions accepted by this tracker. */
  readonly events: Events;
  /**
   * Automatic flush interval in milliseconds. Set to 0 to flush only when the
   * batch size is reached or `flush` is called. Defaults to 5000.
   */
  readonly flushInterval?: number;
  /**
   * Maximum number of queued events before new events are rejected. Defaults
   * to 1000.
   */
  readonly maxQueueSize?: number;
  /**
   * Observes every delivery failure (after retries are exhausted). Receives
   * the batch that could not be delivered, when one exists. Failed batches
   * are dropped.
   */
  readonly onError?: (
    error: unknown,
    batch?: readonly TrackedEvent<Events>[]
  ) => void;
  /** Retry policy (or retry count) for failed sink deliveries. */
  readonly retry?: number | RetryPolicy;
  /** Destination for validated event batches. */
  readonly sink: Sink<Events, Error, Requirements>;
}

/**
 * Per-event options accepted by {@link Tracker.track} and {@link Tracker.trackNow}.
 */
export interface TrackOptions {
  /** Metadata merged onto the tracked event (over tracker `context`). */
  readonly meta?: EventMeta;
  /**
   * Event timestamp in milliseconds since the Unix epoch. Defaults to
   * `Date.now()`.
   */
  readonly timestamp?: number;
}

/**
 * Argument list for `track`/`trackNow`: the payload argument is omittable for
 * payload-less events.
 */
export type TrackArgs<Definition> =
  EventPayload<Definition> extends void
    ? [payload?: undefined, options?: TrackOptions]
    : [payload: EventPayload<Definition>, options?: TrackOptions];

/**
 * Effect-native tracker for validating, queueing, and delivering typed events.
 *
 * Created with {@link make}. Delivery happens on a background fiber, so
 * `track` never waits on the sink. Closing the surrounding scope stops the
 * background fiber and delivers all remaining events.
 */
export interface Tracker<
  Events extends EventsMap,
  Error = never,
  Requirements = never,
> {
  /** Delivers all currently queued events and waits for completion. */
  readonly flush: Effect.Effect<void, Error, Requirements>;
  /** Number of events currently queued. */
  readonly size: Effect.Effect<number>;
  /**
   * Validates and queues an event for batched background delivery. Returns as
   * soon as the event is queued; it never waits on the sink.
   */
  readonly track: <Key extends keyof Events & string>(
    key: Key,
    ...args: TrackArgs<Events[Key]>
  ) => Effect.Effect<void, TrackError>;
  /** Validates an event and delivers it immediately, bypassing the queue. */
  readonly trackNow: <Key extends keyof Events & string>(
    key: Key,
    ...args: TrackArgs<Events[Key]>
  ) => Effect.Effect<
    void,
    Exclude<TrackError, QueueFullError> | Error,
    Requirements
  >;
}

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_FLUSH_INTERVAL = 5000;
const DEFAULT_RETRY_DELAY = 250;
const DEFAULT_RETRY_FACTOR = 2;

/**
 * Creates a tracker that validates event payloads and delivers them to the
 * configured sink in batches on a background fiber.
 *
 * The tracker is scoped: closing the scope interrupts the background fiber
 * and flushes all remaining events through the sink.
 *
 * @param options - Tracker configuration, including event definitions and sink.
 * @returns A scoped Effect producing the tracker.
 */
export function make<
  const Events extends EventsMap,
  Error = never,
  Requirements = never,
>(
  options: TrackerOptions<Events, Error, Requirements>
): Effect.Effect<
  Tracker<Events, Error, Requirements>,
  never,
  Scope.Scope | Requirements
> {
  return Effect.gen(function* () {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    const flushInterval = options.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    const retry = normalizeRetry(options.retry);
    const queue = yield* Queue.dropping<TrackedEvent<Events>>(maxQueueSize);
    const wakeWorker = Latch.makeUnsafe(false);
    const deliveryLock = Semaphore.makeUnsafe(1);
    let closed = false;

    const deliver = (batch: readonly TrackedEvent<Events>[]) =>
      Effect.retry(options.sink(batch), {
        times: retry.attempts,
        schedule: retry.jitter
          ? Schedule.jittered(
              Schedule.exponential(Duration.millis(retry.delay), retry.factor)
            )
          : Schedule.exponential(Duration.millis(retry.delay), retry.factor),
      }).pipe(
        Effect.tapCause((cause) =>
          Effect.sync(() => {
            options.onError?.(Cause.squash(cause), batch);
          })
        )
      );

    const takeBatch = Effect.gen(function* () {
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

    // Serialized with trackNow so batches reach the sink in order. A batch
    // that fails after all retries is reported via onError and dropped;
    // events still in the queue stay queued for the next attempt.
    // Uninterruptible so that closing the scope cannot interrupt the worker
    // between taking a batch off the queue and delivering it — an in-flight
    // batch always completes (or exhausts its retries) before shutdown.
    const drain = deliveryLock.withPermit(
      Effect.uninterruptible(
        Effect.gen(function* () {
          while (true) {
            const batch = yield* takeBatch;

            if (batch.length === 0) {
              return;
            }

            yield* deliver(batch);
          }
        })
      )
    );

    const drainSilently = drain.pipe(Effect.catchCause(() => Effect.void));

    const worker = Effect.gen(function* () {
      while (true) {
        yield* flushInterval > 0
          ? Effect.timeoutOption(
              wakeWorker.await,
              Duration.millis(flushInterval)
            )
          : wakeWorker.await;
        yield* wakeWorker.close;
        yield* drainSilently;
      }
    });

    // Finalizers run in reverse order: mark closed, interrupt the worker
    // (registered by forkScoped), then flush whatever is still queued.
    yield* Effect.addFinalizer(() => drainSilently);
    yield* Effect.forkScoped(worker);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      })
    );

    const makeEvent = Effect.fn("trashlytics.makeEvent")(function* (
      key: keyof Events & string,
      payload: unknown,
      trackOptions: TrackOptions | undefined
    ) {
      if (closed) {
        return yield* new TrackerClosedError();
      }

      const definition = options.events[key];

      if (definition === undefined) {
        return yield* new UnknownEventError({ key });
      }

      const decoded = yield* validatePayload(definition.schema, key, payload);
      const meta = mergeMeta(options.context, trackOptions?.meta);

      const trackedEvent: TrackedEvent<Events> = {
        key,
        name: definition.name,
        payload: decoded as EventPayload<Events[keyof Events & string]>,
        timestamp: trackOptions?.timestamp ?? Date.now(),
        ...(meta === undefined ? {} : { meta }),
      };

      return trackedEvent;
    });

    const track = Effect.fn("trashlytics.track")(function* (
      key: keyof Events & string,
      payload?: unknown,
      trackOptions?: TrackOptions
    ) {
      const trackedEvent = yield* makeEvent(key, payload, trackOptions);

      if (!Queue.offerUnsafe(queue, trackedEvent)) {
        return yield* new QueueFullError({ capacity: maxQueueSize });
      }

      if (Queue.sizeUnsafe(queue) >= batchSize) {
        wakeWorker.openUnsafe();
      }
    });

    const trackNow = Effect.fn("trashlytics.trackNow")(function* (
      key: keyof Events & string,
      payload?: unknown,
      trackOptions?: TrackOptions
    ) {
      const trackedEvent = yield* makeEvent(key, payload, trackOptions);

      yield* deliveryLock.withPermit(deliver([trackedEvent]));
    });

    const tracker: Tracker<Events, Error, Requirements> = {
      track: track as Tracker<Events, Error, Requirements>["track"],
      trackNow: trackNow as Tracker<Events, Error, Requirements>["trackNow"],
      flush: drain,
      size: Effect.sync(() => Queue.sizeUnsafe(queue)),
    };

    return tracker;
  });
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

function validatePayload(
  schema: PayloadSchema | undefined,
  key: string,
  payload: unknown
): Effect.Effect<unknown, EventValidationError> {
  if (schema === undefined) {
    return Effect.void;
  }

  if (isEffectSchema(schema)) {
    return Schema.decodeUnknownEffect(schema)(payload).pipe(
      Effect.mapError(
        (error) =>
          new EventValidationError({
            key,
            issues: [{ message: error.message }],
            cause: error,
          })
      )
    );
  }

  const toEffect = (
    result: StandardResult<unknown>
  ): Effect.Effect<unknown, EventValidationError> =>
    result.issues === undefined
      ? Effect.succeed(result.value)
      : Effect.fail(
          new EventValidationError({
            key,
            issues: result.issues.map(normalizeIssue),
          })
        );

  return Effect.suspend(() => {
    const result = schema["~standard"].validate(payload);

    return result instanceof Promise
      ? Effect.promise(() => result).pipe(Effect.flatMap(toEffect))
      : toEffect(result);
  });
}

function normalizeIssue(issue: StandardIssue): ValidationIssue {
  return {
    message: issue.message,
    path: issue.path?.map((segment) =>
      typeof segment === "object" && segment !== null && "key" in segment
        ? segment.key
        : segment
    ),
  };
}

function mergeMeta(
  context: EventMeta | (() => EventMeta) | undefined,
  meta: EventMeta | undefined
): EventMeta | undefined {
  const contextMeta = typeof context === "function" ? context() : context;

  if (contextMeta === undefined) {
    return meta;
  }

  return { ...contextMeta, ...meta };
}

function normalizeRetry(retry: number | RetryPolicy | undefined) {
  if (typeof retry === "number") {
    return {
      attempts: retry,
      delay: DEFAULT_RETRY_DELAY,
      factor: DEFAULT_RETRY_FACTOR,
      jitter: false,
    };
  }

  return {
    attempts: retry?.attempts ?? 0,
    delay: retry?.delay ?? DEFAULT_RETRY_DELAY,
    factor: retry?.factor ?? DEFAULT_RETRY_FACTOR,
    jitter: retry?.jitter ?? false,
  };
}

const isEffectSchema = (value: unknown): value is AnyEffectSchema =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "ast" in value &&
  "rebuild" in value;

const isStandardSchema = (value: unknown): value is StandardSchemaV1 =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "~standard" in value;
