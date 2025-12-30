/**
 * Event types and helpers.
 *
 * @since 1.0.0
 */

/**
 * Represents a tracked event with generic payload.
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
 */
export interface EventOptions {
  readonly id: string;
  readonly metadata?: Record<string, unknown>;
  readonly timestamp?: number;
}

/**
 * Creates a new event with the given name, payload, and options.
 *
 * @example
 * ```ts
 * const event = createEvent("page_view", { page: "/home" }, {
 *   id: "abc123",
 *   metadata: { userId: "user_1" }
 * })
 * ```
 */
export const createEvent = <T>(
  name: string,
  payload: T,
  options: EventOptions
): Event<T> => ({
  id: options.id,
  name,
  timestamp: options.timestamp ?? Date.now(),
  payload,
  metadata: options.metadata ?? {},
});
