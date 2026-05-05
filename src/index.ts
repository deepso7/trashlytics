import { Effect } from "effect";
import type {
  EventPayload as EffectEventPayload,
  EventsMap as EffectEventsMap,
  HttpSinkOptions as EffectHttpSinkOptions,
  TrackedEvent as EffectTrackedEvent,
  TrackerOptions as EffectTrackerOptions,
  TrackOptions as EffectTrackOptions,
} from "./effect";
import {
  createTracker as createEffectTracker,
  consoleSink as effectConsoleSink,
  event as effectEvent,
  httpSink as effectHttpSink,
  SinkDeliveryError,
} from "./effect";

export type {
  EventDefinition,
  EventMeta,
  EventPayload,
  EventsMap,
  HttpSinkOptions,
  RetryOptions,
  TrackedEvent,
  TrackOptions,
} from "./effect";

export const event = effectEvent;

type Timer = ReturnType<typeof setTimeout>;

export type Sink<Events extends EffectEventsMap> = (
  batch: readonly EffectTrackedEvent<Events>[]
) => void | Promise<void>;

export type TrackerOptions<Events extends EffectEventsMap> = Omit<
  EffectTrackerOptions<Events, SinkDeliveryError, never>,
  "sink"
> & {
  readonly sink: Sink<Events>;
  readonly flushInterval?: number;
  readonly onError?: (
    error: unknown,
    batch?: readonly EffectTrackedEvent<Events>[]
  ) => void;
};

export interface Tracker<Events extends EffectEventsMap> {
  readonly flush: () => Promise<void>;
  readonly shutdown: () => Promise<void>;
  readonly track: <Key extends keyof Events & string>(
    key: Key,
    payload: EffectEventPayload<Events[Key]>,
    options?: EffectTrackOptions
  ) => void;
  readonly trackNow: <Key extends keyof Events & string>(
    key: Key,
    payload: EffectEventPayload<Events[Key]>,
    options?: EffectTrackOptions
  ) => Promise<void>;
}

export function createTracker<const Events extends EffectEventsMap>(
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
      flush().catch(() => undefined);
    }, flushInterval);
  };

  return {
    track: (key, payload, trackOptions) => {
      Effect.runPromise(tracker.track(key, payload, trackOptions))
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

export function consoleSink<Events extends EffectEventsMap>(
  log: Pick<Console, "log"> = console
): Sink<Events> {
  return (batch) => Effect.runSync(effectConsoleSink<Events>(log)(batch));
}

export function httpSink<Events extends EffectEventsMap>(
  url: string | URL,
  options: EffectHttpSinkOptions = {}
): Sink<Events> {
  return (batch) =>
    Effect.runPromise(effectHttpSink<Events>(url, options)(batch));
}
