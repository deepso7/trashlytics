import { Effect, Exit, Scope } from "effect";
import type {
  Sink as EffectSink,
  TrackerOptions as EffectTrackerOptions,
  EventsMap,
  TrackArgs,
  TrackedEvent,
} from "./effect";
import { make, SinkError } from "./effect";

// Runtime support for `await using` on platforms that predate the explicit
// resource management proposal.
(Symbol as { asyncDispose?: symbol }).asyncDispose ??= Symbol.for(
  "Symbol.asyncDispose"
);

export type {
  EventDefinition,
  EventMeta,
  EventPayload,
  EventsMap,
  HttpSinkOptions,
  RetryPolicy,
  StandardIssue,
  StandardResult,
  StandardSchemaV1,
  TrackError,
  TrackedEvent,
  TrackOptions,
  ValidationIssue,
} from "./effect";
// biome-ignore lint/performance/noBarrelFile: the root entry intentionally shares the event/sink/error API with the Effect entry.
export {
  beaconSink,
  consoleSink,
  EventValidationError,
  event,
  httpSink,
  QueueFullError,
  SinkError,
  TrackerClosedError,
  UnknownEventError,
} from "./effect";

/**
 * Sink that receives validated events in batches.
 *
 * May return `void`, a `Promise`, or an Effect — so the sinks exported from
 * this module ({@link httpSink}, {@link beaconSink}, {@link consoleSink}) and
 * plain async functions both work.
 */
export type Sink<Events extends EventsMap> = (
  batch: readonly TrackedEvent<Events>[]
) => void | Promise<void> | Effect.Effect<void, unknown>;

/**
 * Configuration used to create a Promise-style tracker.
 */
export type TrackerOptions<Events extends EventsMap> = Omit<
  EffectTrackerOptions<Events, unknown, never>,
  "sink"
> & {
  /** Destination for validated event batches. */
  readonly sink: Sink<Events>;
  /**
   * Flushes pending events when the page is hidden or unloading (browsers
   * only; ignored elsewhere). Defaults to true.
   */
  readonly flushOnHide?: boolean;
};

/**
 * Promise-style tracker for validating, queueing, and delivering typed events.
 *
 * Supports `await using tracker = createTracker(...)` for automatic cleanup.
 */
export interface Tracker<Events extends EventsMap> extends AsyncDisposable {
  /**
   * Stops background delivery, flushes all remaining events, and releases
   * resources. Idempotent. Tracking after `close` reports
   * `TrackerClosedError` through `onError`.
   */
  readonly close: () => Promise<void>;
  /** Delivers all currently queued events and waits for completion. */
  readonly flush: () => Promise<void>;
  /**
   * Validates and queues an event for batched background delivery. Fire and
   * forget: it never throws and never waits on the sink. Validation and
   * delivery failures are reported through `onError`.
   */
  readonly track: <Key extends keyof Events & string>(
    key: Key,
    ...args: TrackArgs<Events[Key]>
  ) => void;
  /** Validates an event and delivers it immediately, bypassing the queue. */
  readonly trackNow: <Key extends keyof Events & string>(
    key: Key,
    ...args: TrackArgs<Events[Key]>
  ) => Promise<void>;
}

/**
 * Creates a Promise-style tracker that validates event payloads before
 * delivering them to the configured sink in batches on a background fiber.
 *
 * @param options - Tracker configuration, including event definitions and sink.
 * @returns A tracker whose operations use Promise-style APIs.
 */
export function createTracker<const Events extends EventsMap>(
  options: TrackerOptions<Events>
): Tracker<Events> {
  const scope = Scope.makeUnsafe();
  const tracker = Effect.runSync(
    Scope.provide(make({ ...options, sink: adaptSink(options.sink) }), scope)
  );

  // In-flight fire-and-forget track() calls (e.g. awaiting async Standard
  // Schema validation). flush() and close() wait for these so events tracked
  // before the call cannot be lost.
  const inFlight = new Set<Promise<void>>();
  const settleInFlight = async () => {
    while (inFlight.size > 0) {
      await Promise.allSettled([...inFlight]);
    }
  };

  const flush = async () => {
    await settleInFlight();
    await Effect.runPromise(tracker.flush);
  };

  const detachLifecycle = attachLifecycleFlush(
    options.flushOnHide ?? true,
    () => {
      flush().catch(() => {
        // Delivery failures are already reported through onError.
      });
    }
  );

  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      detachLifecycle();
      await settleInFlight();
      await Effect.runPromise(Scope.close(scope, Exit.void));
    })();

    return closing;
  };

  return {
    track: (key, ...args) => {
      const pending: Promise<void> = Effect.runPromise(
        tracker.track(key, ...args)
      )
        .catch((error) => {
          options.onError?.(error);
        })
        .finally(() => {
          inFlight.delete(pending);
        });

      inFlight.add(pending);
    },

    trackNow: (key, ...args) =>
      Effect.runPromise(tracker.trackNow(key, ...args)),

    flush,

    close,

    [Symbol.asyncDispose]: close,
  };
}

function adaptSink<Events extends EventsMap>(
  sink: Sink<Events>
): EffectSink<Events, unknown> {
  return (batch) =>
    Effect.suspend(() => {
      let result: ReturnType<Sink<Events>>;

      try {
        result = sink(batch);
      } catch (cause) {
        return Effect.fail(new SinkError({ cause }));
      }

      if (Effect.isEffect(result)) {
        return result;
      }

      if (result instanceof Promise) {
        return Effect.tryPromise({
          try: () => result as Promise<void>,
          catch: (cause) => new SinkError({ cause }),
        });
      }

      return Effect.void;
    });
}

function attachLifecycleFlush(enabled: boolean, flush: () => void): () => void {
  if (!enabled || typeof document === "undefined") {
    return () => {
      // Nothing to detach outside browsers.
    };
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  addEventListener("pagehide", flush);

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    removeEventListener("pagehide", flush);
  };
}
