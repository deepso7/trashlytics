import { Duration, Effect, Schedule, Schema } from "effect";

type AnySchema = Schema.Decoder<unknown, never>;
type EventFields = Schema.Struct.Fields;

export class UnknownEventError extends Schema.TaggedErrorClass<UnknownEventError>()(
  "UnknownEventError",
  {
    key: Schema.String,
  }
) {}

export class TrackerShutdownError extends Schema.TaggedErrorClass<TrackerShutdownError>()(
  "TrackerShutdownError",
  {}
) {}

export class BufferFullError extends Schema.TaggedErrorClass<BufferFullError>()(
  "BufferFullError",
  {
    size: Schema.Number,
  }
) {}

export class SinkDeliveryError extends Schema.TaggedErrorClass<SinkDeliveryError>()(
  "SinkDeliveryError",
  {
    cause: Schema.Unknown,
  }
) {}

export interface EventDefinition<Name extends string, Payload> {
  readonly name: Name;
  readonly schema: Schema.Decoder<Payload, never>;
}

export type EventPayload<Definition> =
  Definition extends EventDefinition<string, infer Payload> ? Payload : never;

export type EventsMap = Record<string, EventDefinition<string, unknown>>;

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

export type EventMeta = Record<string, unknown>;

export type Sink<
  Events extends EventsMap,
  Error = never,
  Requirements = never,
> = (
  batch: readonly TrackedEvent<Events>[]
) => Effect.Effect<void, Error, Requirements>;

export interface RetryOptions {
  readonly attempts?: number;
  readonly delay?: number;
  readonly factor?: number;
}

export interface TrackerOptions<
  Events extends EventsMap,
  Error = never,
  Requirements = never,
> {
  readonly batchSize?: number;
  readonly bufferSize?: number;
  readonly events: Events;
  readonly retries?: number | RetryOptions;
  readonly sink: Sink<Events, Error, Requirements>;
}

export interface TrackOptions {
  readonly meta?: EventMeta;
  readonly timestamp?: number;
}

export type TrackError =
  | Schema.SchemaError
  | UnknownEventError
  | TrackerShutdownError
  | BufferFullError;

export interface Tracker<
  Events extends EventsMap,
  Error = never,
  Requirements = never,
> {
  readonly flush: () => Effect.Effect<void, Error, Requirements>;
  readonly shutdown: () => Effect.Effect<void, Error, Requirements>;
  readonly track: <Key extends keyof Events & string>(
    key: Key,
    payload: EventPayload<Events[Key]>,
    options?: TrackOptions
  ) => Effect.Effect<void, TrackError | Error, Requirements>;
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

export function event<
  const Name extends string,
  const Fields extends EventFields,
>(name: Name, fields: Fields): EventDefinition<Name, InferFields<Fields>>;
export function event<
  const Name extends string,
  const EventSchema extends AnySchema,
>(
  name: Name,
  schema: EventSchema
): EventDefinition<Name, Schema.Schema.Type<EventSchema>>;
export function event(name: string, schemaOrFields: AnySchema | EventFields) {
  return {
    name,
    schema: isSchema(schemaOrFields)
      ? schemaOrFields
      : Schema.Struct(schemaOrFields),
  };
}

export function createTracker<
  const Events extends EventsMap,
  Error = never,
  Requirements = never,
>(
  options: TrackerOptions<Events, Error, Requirements>
): Tracker<Events, Error, Requirements> {
  const batchSize = options.batchSize ?? 20;
  const bufferSize = options.bufferSize ?? 1000;
  const retryOptions = normalizeRetries(options.retries);
  const queue: TrackedEvent<Events>[] = [];
  let closed = false;

  const flush = Effect.fn("trashlytics.flush")(function* () {
    while (queue.length > 0) {
      const batch = queue.splice(0, batchSize);

      yield* sendWithRetries(options.sink, batch, retryOptions);
    }
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

        if (queue.length >= bufferSize) {
          return yield* new BufferFullError({ size: bufferSize });
        }

        queue.push(trackedEvent);

        if (queue.length >= batchSize) {
          yield* flush();
        }
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
      yield* flush();
    }),
  };
}

export function consoleSink<Events extends EventsMap>(
  log: Pick<Console, "log"> = console
): Sink<Events> {
  return (batch) =>
    Effect.sync(() => {
      log.log(batch);
    });
}

export type HttpSinkOptions = Omit<RequestInit, "body" | "method"> & {
  readonly method?: "POST" | "PUT" | "PATCH";
};

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
