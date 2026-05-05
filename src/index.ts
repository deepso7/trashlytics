import { Duration, Effect, Schedule, Schema } from "effect";

type AnySchema = Schema.Decoder<any, never>;
type EventFields = Schema.Struct.Fields;
type Timer = ReturnType<typeof setTimeout>;

class SinkDeliveryError extends Schema.TaggedErrorClass<SinkDeliveryError>()(
  "SinkDeliveryError",
  {
    cause: Schema.Unknown,
  }
) {}

export type EventDefinition<Name extends string, Payload> = {
  readonly name: Name;
  readonly schema: Schema.Decoder<Payload, never>;
};

export type EventPayload<Definition> = Definition extends EventDefinition<
  string,
  infer Payload
>
  ? Payload
  : never;

export type EventsMap = Record<string, EventDefinition<string, any>>;

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

export type Sink<Events extends EventsMap> = (
  batch: ReadonlyArray<TrackedEvent<Events>>
) => void | Promise<void>;

export type RetryOptions = {
  readonly attempts?: number;
  readonly delay?: number;
  readonly factor?: number;
};

export type TrackerOptions<Events extends EventsMap> = {
  readonly events: Events;
  readonly sink: Sink<Events>;
  readonly batchSize?: number;
  readonly flushInterval?: number;
  readonly bufferSize?: number;
  readonly retries?: number | RetryOptions;
  readonly onError?: (
    error: unknown,
    batch?: ReadonlyArray<TrackedEvent<Events>>
  ) => void;
};

export type TrackOptions = {
  readonly timestamp?: number;
  readonly meta?: EventMeta;
};

export type Tracker<Events extends EventsMap> = {
  readonly track: <Key extends keyof Events & string>(
    key: Key,
    payload: EventPayload<Events[Key]>,
    options?: TrackOptions
  ) => void;
  readonly trackNow: <Key extends keyof Events & string>(
    key: Key,
    payload: EventPayload<Events[Key]>,
    options?: TrackOptions
  ) => Promise<void>;
  readonly flush: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
};

type InferFields<Fields extends EventFields> = Schema.Schema.Type<
  Schema.Struct<Fields>
>;

export function event<const Name extends string, const Fields extends EventFields>(
  name: Name,
  fields: Fields
): EventDefinition<Name, InferFields<Fields>>;
export function event<const Name extends string, const EventSchema extends AnySchema>(
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

export function createTracker<const Events extends EventsMap>(
  options: TrackerOptions<Events>
): Tracker<Events> {
  const batchSize = options.batchSize ?? 20;
  const bufferSize = options.bufferSize ?? 1000;
  const flushInterval = options.flushInterval ?? 5000;
  const retryOptions = normalizeRetries(options.retries);
  const queue: Array<TrackedEvent<Events>> = [];
  let timer: Timer | undefined;
  let pendingFlush: Promise<void> | undefined;
  let closed = false;

  const clearFlushTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const scheduleFlush = () => {
    if (closed || flushInterval <= 0 || timer !== undefined) {
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch((error) => options.onError?.(error));
    }, flushInterval);
  };

  const makeEvent = <Key extends keyof Events & string>(
    key: Key,
    payload: EventPayload<Events[Key]>,
    trackOptions?: TrackOptions
  ): TrackedEvent<Events, Key> => {
    const definition = options.events[key];

    if (definition === undefined) {
      throw new Error(`Unknown event: ${key}`);
    }

    return {
      key,
      name: definition.name,
      payload: Schema.decodeUnknownSync(definition.schema)(payload),
      timestamp: trackOptions?.timestamp ?? Date.now(),
      ...(trackOptions?.meta === undefined ? {} : { meta: trackOptions.meta }),
    };
  };

  const flush = async () => {
    if (pendingFlush !== undefined) {
      return pendingFlush;
    }

    pendingFlush = (async () => {
      clearFlushTimer();

      while (queue.length > 0) {
        const batch = queue.splice(0, batchSize);

        try {
          await Effect.runPromise(
            sendWithRetries(options.sink, batch, retryOptions)
          );
        } catch (error) {
          options.onError?.(error, batch);
          throw error;
        }
      }
    })().finally(() => {
      pendingFlush = undefined;

      if (queue.length > 0) {
        scheduleFlush();
      }
    });

    return pendingFlush;
  };

  return {
    track: (key, payload, trackOptions) => {
      if (closed) {
        options.onError?.(new Error("Tracker is shutdown"));
        return;
      }

      let trackedEvent: TrackedEvent<Events>;

      try {
        trackedEvent = makeEvent(key, payload, trackOptions);
      } catch (error) {
        options.onError?.(error);
        return;
      }

      if (queue.length >= bufferSize) {
        options.onError?.(new Error("Tracker buffer is full"), [trackedEvent]);
        return;
      }

      queue.push(trackedEvent);

      if (queue.length >= batchSize) {
        void flush().catch(() => undefined);
        return;
      }

      scheduleFlush();
    },

    trackNow: async (key, payload, trackOptions) => {
      if (closed) {
        throw new Error("Tracker is shutdown");
      }

      await Effect.runPromise(
        sendWithRetries(options.sink, [makeEvent(key, payload, trackOptions)], retryOptions)
      );
    },

    flush,

    shutdown: async () => {
      closed = true;
      await flush();
      clearFlushTimer();
    },
  };
}

export function consoleSink<Events extends EventsMap>(
  log: Pick<Console, "log"> = console
): Sink<Events> {
  return (batch) => {
    log.log(batch);
  };
}

export type HttpSinkOptions = Omit<RequestInit, "body" | "method"> & {
  readonly method?: "POST" | "PUT" | "PATCH";
};

export function httpSink<Events extends EventsMap>(
  url: string | URL,
  options: HttpSinkOptions = {}
): Sink<Events> {
  return async (batch) => {
    const headers = new Headers(options.headers);

    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await globalThis.fetch(url, {
      ...options,
      headers,
      method: options.method ?? "POST",
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      throw new Error(`HTTP sink failed with status ${response.status}`);
    }
  };
}

const isSchema = (value: unknown): value is AnySchema =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "ast" in value &&
  "rebuild" in value;

const normalizeRetries = (
  retries: TrackerOptions<EventsMap>["retries"]
): Required<RetryOptions> => {
  if (typeof retries === "number") {
    return { attempts: retries, delay: 250, factor: 2 };
  }

  return {
    attempts: retries?.attempts ?? 0,
    delay: retries?.delay ?? 250,
    factor: retries?.factor ?? 2,
  };
};

const sendWithRetries = <Events extends EventsMap>(
  sink: Sink<Events>,
  batch: ReadonlyArray<TrackedEvent<Events>>,
  retries: Required<RetryOptions>
): Effect.Effect<void, SinkDeliveryError> =>
  Effect.retry(
    Effect.tryPromise({
      try: async () => {
        await sink(batch);
      },
      catch: (cause) => new SinkDeliveryError({ cause }),
    }),
    {
      times: retries.attempts,
      schedule: Schedule.exponential(
        Duration.millis(retries.delay),
        retries.factor
      ),
    }
  );
