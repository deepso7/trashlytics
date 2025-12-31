/**
 * Event types and helpers.
 *
 * @since 1.0.0
 */

/**
 * Event map type for defining typed events.
 * Keys are event names, values are payload types.
 *
 * @example
 * ```ts
 * interface MyEvents {
 *   page_view: { page: string; referrer?: string }
 *   button_click: { buttonId: string; label: string }
 *   purchase: { productId: string; amount: number }
 * }
 * ```
 */
export interface EventMap {
  [eventName: string]: unknown;
}

/**
 * Utility type to get the union of all payload types from an EventMap.
 *
 * @example
 * ```ts
 * type MyEvents = {
 *   page_view: { page: string }
 *   button_click: { buttonId: string }
 * }
 *
 * type Payload = EventUnion<MyEvents>
 * // { page: string } | { buttonId: string }
 * ```
 */
export type EventUnion<E extends EventMap> = E[keyof E];

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
