/**
 * Dispatcher module - handles batch dispatch with retry and fan-out.
 *
 * @since 1.0.0
 */
import { Context, Effect, Schedule } from "effect";
import type { Config } from "./Config.js";
import type { Event } from "./Event.js";
import type { TransportError } from "./Transport.js";
import { type Transport, Transports } from "./Transport.js";

/**
 * Dispatcher service interface.
 *
 * @since 1.0.0
 */
export interface IDispatcher {
  /**
   * Dispatch a batch of events to all transports.
   * Retries on failure and calls onError for failed transports.
   */
  readonly dispatch: (
    events: readonly Event[]
  ) => Effect.Effect<void, TransportError>;
}

/**
 * Service tag for the dispatcher.
 *
 * @since 1.0.0
 */
export class Dispatcher extends Context.Tag("trashlytics/Dispatcher")<
  Dispatcher,
  IDispatcher
>() {}

type DispatchResult =
  | { readonly transport: string; readonly success: true }
  | {
      readonly transport: string;
      readonly success: false;
      readonly error: TransportError;
    };

const sendToTransport = (
  transport: Transport,
  events: readonly Event[],
  retrySchedule: Schedule.Schedule<unknown, unknown>
): Effect.Effect<DispatchResult, never> =>
  transport.send(events).pipe(
    Effect.retry({
      schedule: retrySchedule,
      while: (err) => err.retryable,
    }),
    Effect.matchEffect({
      onSuccess: () =>
        Effect.succeed({ transport: transport.name, success: true as const }),
      onFailure: (error) =>
        Effect.succeed({
          transport: transport.name,
          success: false as const,
          error,
        }),
    })
  );

const handleResults = (
  results: readonly DispatchResult[],
  events: readonly Event[],
  onError?: Config["onError"]
): Effect.Effect<void, TransportError> => {
  const failures = results.filter(
    (r): r is Extract<DispatchResult, { success: false }> => !r.success
  );

  // Log and call onError for each failure
  for (const failure of failures) {
    if (typeof console !== "undefined") {
      console.error(
        `[trashlytics] Transport "${failure.transport}" failed:`,
        failure.error.reason
      );
    }
    onError?.(failure.error, events);
  }

  // Fail if all transports failed
  const firstFailure = failures[0];
  if (firstFailure && failures.length === results.length) {
    return Effect.fail(firstFailure.error);
  }

  return Effect.void;
};

/**
 * Create a dispatcher with the given configuration.
 *
 * @since 1.0.0
 */
export const make = (
  config: Config
): Effect.Effect<IDispatcher, never, Transports> =>
  Effect.gen(function* () {
    const transports = yield* Transports;

    const retrySchedule =
      config.retrySchedule ??
      Schedule.exponential("1 second").pipe(
        Schedule.jittered,
        Schedule.compose(Schedule.recurs(config.retryAttempts ?? 3))
      );

    return {
      dispatch: (events) => {
        if (events.length === 0) {
          return Effect.void;
        }

        return Effect.forEach(
          transports,
          (transport) => sendToTransport(transport, events, retrySchedule),
          { concurrency: "unbounded" }
        ).pipe(
          Effect.flatMap((results) =>
            handleResults(results, events, config.onError)
          )
        );
      },
    };
  });
