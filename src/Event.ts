/**
 * Event module - defines the core event structure.
 *
 * @since 1.0.0
 */

/**
 * Represents a tracked event with generic payload.
 *
 * @since 1.0.0
 */
export interface Event<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;
  readonly payload: T;
  readonly metadata: Record<string, unknown>;
}

/**
 * Options for creating an event.
 *
 * @since 1.0.0
 */
export interface MakeOptions {
  readonly id: string;
  readonly metadata?: Record<string, unknown>;
  readonly timestamp?: number;
}

/**
 * Creates a new event with the given name, payload, and options.
 *
 * @since 1.0.0
 * @example
 * ```ts
 * import { Event } from "trashlytics"
 *
 * const event = Event.make("page_view", { page: "/home" }, {
 *   id: "abc123",
 *   metadata: { userId: "user_1" }
 * })
 * ```
 */
export const make = <T>(
  name: string,
  payload: T,
  options: MakeOptions
): Event<T> => ({
  id: options.id,
  name,
  timestamp: options.timestamp ?? Date.now(),
  payload,
  metadata: options.metadata ?? {},
});
