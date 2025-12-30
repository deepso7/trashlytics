/**
 * Queue module - event queue with configurable overflow strategy.
 *
 * @since 1.0.0
 */
import { Context, Effect, Queue } from "effect";
import type { QueueStrategy } from "./Config.js";
import type { Event } from "./Event.js";

/**
 * Internal event queue service interface.
 *
 * @since 1.0.0
 */
export interface IEventQueue {
  /**
   * Offer an event to the queue.
   * Returns true if the event was accepted, false if dropped.
   */
  readonly offer: (event: Event) => Effect.Effect<boolean, never>;

  /**
   * Take all events currently in the queue.
   */
  readonly takeAll: Effect.Effect<readonly Event[], never>;

  /**
   * Take between min and max events from the queue.
   * Blocks until at least min events are available.
   */
  readonly takeBetween: (
    min: number,
    max: number
  ) => Effect.Effect<readonly Event[], never>;

  /**
   * Take up to n events from the queue (non-blocking).
   */
  readonly takeUpTo: (n: number) => Effect.Effect<readonly Event[], never>;

  /**
   * Get the current queue size.
   */
  readonly size: Effect.Effect<number, never>;

  /**
   * Shutdown the queue.
   */
  readonly shutdown: Effect.Effect<void, never>;

  /**
   * Check if the queue is shutdown.
   */
  readonly isShutdown: Effect.Effect<boolean, never>;
}

/**
 * Service tag for the event queue.
 *
 * @since 1.0.0
 */
export class EventQueue extends Context.Tag("trashlytics/EventQueue")<
  EventQueue,
  IEventQueue
>() {}

/**
 * Create an event queue with the given capacity and strategy.
 *
 * @since 1.0.0
 */
export const make = (
  capacity: number,
  strategy: QueueStrategy
): Effect.Effect<IEventQueue, never> =>
  Effect.gen(function* () {
    const queue = yield* createQueue(capacity, strategy);

    return {
      offer: (event) =>
        Queue.offer(queue, event).pipe(
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false))
        ),

      takeAll: Queue.takeAll(queue).pipe(Effect.map((chunk) => [...chunk])),

      takeBetween: (min, max) =>
        Queue.takeBetween(queue, min, max).pipe(
          Effect.map((chunk) => [...chunk])
        ),

      takeUpTo: (n) =>
        Queue.takeUpTo(queue, n).pipe(Effect.map((chunk) => [...chunk])),

      size: Queue.size(queue),

      shutdown: Queue.shutdown(queue),

      isShutdown: Queue.isShutdown(queue),
    };
  });

/**
 * Create the underlying Effect queue based on strategy.
 */
const createQueue = (capacity: number, strategy: QueueStrategy) => {
  switch (strategy) {
    case "bounded":
      return Queue.bounded<Event>(capacity);
    case "dropping":
      return Queue.dropping<Event>(capacity);
    case "sliding":
      return Queue.sliding<Event>(capacity);
    default:
      return Queue.dropping<Event>(capacity);
  }
};
