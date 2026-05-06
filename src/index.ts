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

/**
 * Creates a typed event definition from a public event name and an Effect schema
 * or `Schema.Struct` fields.
 *
 * @param name - Public event name delivered to sinks.
 * @param schemaOrFields - Full schema or struct fields used for payload validation.
 * @returns A typed event definition for use in a tracker event registry.
 */
export const event = effectEvent;

/**
 * Promise-style sink that receives validated events in batches.
 */
export type Sink<Events extends EffectEventsMap> = (
  batch: readonly EffectTrackedEvent<Events>[]
) => void | Promise<void>;

/**
 * Configuration used to create a Promise-style tracker.
 */
export type TrackerOptions<Events extends EffectEventsMap> = Omit<
  EffectTrackerOptions<Events, SinkDeliveryError, never>,
  "onError" | "sink"
> & {
  /** Destination for validated event batches. */
  readonly sink: Sink<Events>;
  /** Automatic flush interval in milliseconds. Set to 0 to disable. */
  readonly flushInterval?: number;
  /** Called when asynchronous tracking or background delivery fails. */
  readonly onError?: (
    error: unknown,
    batch?: readonly EffectTrackedEvent<Events>[]
  ) => void;
};

/**
 * Promise-style tracker for validating, queueing, and delivering typed events.
 */
export interface Tracker<Events extends EffectEventsMap> {
  /** Delivers all currently queued events. */
  readonly flush: () => Promise<void>;
  /** Stops background flushing and delivers remaining queued events. */
  readonly shutdown: () => Promise<void>;
  /** Validates and queues an event for batched delivery. */
  readonly track: <Key extends keyof Events & string>(
    key: Key,
    payload: EffectEventPayload<Events[Key]>,
    options?: EffectTrackOptions
  ) => void;
  /** Validates an event and delivers it immediately without queueing. */
  readonly trackNow: <Key extends keyof Events & string>(
    key: Key,
    payload: EffectEventPayload<Events[Key]>,
    options?: EffectTrackOptions
  ) => Promise<void>;
}

/**
 * Creates a Promise-style tracker that validates event payloads before
 * delivering them to the configured sink.
 *
 * @param options - Tracker configuration, including event definitions and sink.
 * @returns A tracker whose operations use Promise-style APIs.
 */
export function createTracker<const Events extends EffectEventsMap>(
  options: TrackerOptions<Events>
): Tracker<Events> {
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
    flushInterval: options.flushInterval,
    onError: options.onError,
    retries: options.retries,
  });

  const flush = async () => {
    try {
      await Effect.runPromise(tracker.flush());
    } catch (error) {
      options.onError?.(error);
      throw error;
    }
  };

  return {
    track: (key, payload, trackOptions) => {
      Effect.runPromise(tracker.track(key, payload, trackOptions)).catch(
        (error) => options.onError?.(error)
      );
    },

    trackNow: (key, payload, trackOptions) =>
      Effect.runPromise(tracker.trackNow(key, payload, trackOptions)),

    flush,

    shutdown: async () => {
      await Effect.runPromise(tracker.shutdown());
    },
  };
}

/**
 * Creates a sink that logs each delivered batch with `console.log`.
 *
 * @param log - Logger implementation to receive delivered batches.
 * @returns A Promise-style sink for tracker configuration.
 */
export function consoleSink<Events extends EffectEventsMap>(
  log: Pick<Console, "log"> = console
): Sink<Events> {
  return (batch) => Effect.runSync(effectConsoleSink<Events>(log)(batch));
}

/**
 * Creates a sink that posts JSON-encoded batches to an HTTP endpoint.
 *
 * @param url - HTTP endpoint that receives event batches.
 * @param options - Fetch options and optional delivery method.
 * @returns A Promise-style sink for tracker configuration.
 */
export function httpSink<Events extends EffectEventsMap>(
  url: string | URL,
  options: EffectHttpSinkOptions = {}
): Sink<Events> {
  return (batch) =>
    Effect.runPromise(effectHttpSink<Events>(url, options)(batch));
}
