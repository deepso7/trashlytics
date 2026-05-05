import { Effect } from "effect";
import {
  consoleSink as effectConsoleSink,
  createTracker as createEffectTracker,
  event,
  httpSink as effectHttpSink,
  SinkDeliveryError,
} from "./effect";
import type {
  EventDefinition,
  EventMeta,
  EventPayload,
  EventsMap,
  HttpSinkOptions,
  RetryOptions,
  TrackOptions,
  TrackedEvent,
  TrackerOptions as EffectTrackerOptions,
} from "./effect";

type Timer = ReturnType<typeof setTimeout>;

export { event };
export type {
  EventDefinition,
  EventMeta,
  EventPayload,
  EventsMap,
  HttpSinkOptions,
  RetryOptions,
  TrackOptions,
  TrackedEvent,
};

export type Sink<Events extends EventsMap> = (
  batch: ReadonlyArray<TrackedEvent<Events>>
) => void | Promise<void>;

export type TrackerOptions<Events extends EventsMap> = Omit<
  EffectTrackerOptions<Events, SinkDeliveryError, never>,
  "sink"
> & {
  readonly sink: Sink<Events>;
  readonly flushInterval?: number;
  readonly onError?: (
    error: unknown,
    batch?: ReadonlyArray<TrackedEvent<Events>>
  ) => void;
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

export function createTracker<const Events extends EventsMap>(
  options: TrackerOptions<Events>
): Tracker<Events> {
  const flushInterval = options.flushInterval ?? 5000;
  let timer: Timer | undefined;

  const tracker = createEffectTracker({
    events: options.events,
    sink: (batch) =>
      Effect.tryPromise({
        try: async () => {
          await options.sink(batch);
        },
        catch: (cause) => new SinkDeliveryError({ cause }),
      }),
    batchSize: options.batchSize,
    bufferSize: options.bufferSize,
    retries: options.retries,
  });

  const clearFlushTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const flush = async () => {
    clearFlushTimer();
    try {
      await Effect.runPromise(tracker.flush());
    } catch (error) {
      options.onError?.(error);
      throw error;
    }
  };

  const scheduleFlush = () => {
    if (flushInterval <= 0 || timer !== undefined) {
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch(() => undefined);
    }, flushInterval);
  };

  return {
    track: (key, payload, trackOptions) => {
      void Effect.runPromise(tracker.track(key, payload, trackOptions))
        .then(scheduleFlush)
        .catch((error) => options.onError?.(error));
    },

    trackNow: (key, payload, trackOptions) =>
      Effect.runPromise(tracker.trackNow(key, payload, trackOptions)),

    flush,

    shutdown: async () => {
      clearFlushTimer();
      await Effect.runPromise(tracker.shutdown());
    },
  };
}

export function consoleSink<Events extends EventsMap>(
  log: Pick<Console, "log"> = console
): Sink<Events> {
  return (batch) => Effect.runSync(effectConsoleSink<Events>(log)(batch));
}

export function httpSink<Events extends EventsMap>(
  url: string | URL,
  options: HttpSinkOptions = {}
): Sink<Events> {
  return (batch) => Effect.runPromise(effectHttpSink<Events>(url, options)(batch));
}
