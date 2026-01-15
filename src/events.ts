/**
 * Represents a tracked event with generic payload.
 */
export interface Event<T = string, U = unknown> {
  readonly id: string;
  readonly name: T;
  readonly timestamp: number;
  readonly payload: U;
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
export const createEvent = <T, U>(
  name: T,
  payload: U,
  options: EventOptions
): Event<T> => ({
  id: options.id,
  name,
  timestamp: options.timestamp ?? Date.now(),
  payload,
  metadata: options.metadata ?? {},
});
