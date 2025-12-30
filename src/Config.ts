/**
 * Config module - defines configuration for the tracker.
 *
 * @since 1.0.0
 */
import { Duration, type Schedule } from "effect";
import type { Event } from "./Event.js";
import type { TransportError } from "./Transport.js";

/**
 * Queue overflow strategy.
 *
 * - `bounded`: Back-pressure (blocks when full)
 * - `dropping`: Drops new events when full
 * - `sliding`: Drops oldest events when full
 *
 * @since 1.0.0
 */
export type QueueStrategy = "bounded" | "dropping" | "sliding";

/**
 * Configuration for the Tracker.
 *
 * @since 1.0.0
 */
export interface Config {
  /**
   * Custom ID generator for events.
   * If not provided, uses a default UUID/random generator.
   */
  readonly generateId?: () => string;

  /**
   * Number of events to batch before sending.
   * @default 10
   */
  readonly batchSize?: number;

  /**
   * Maximum time to wait before flushing events.
   * @default Duration.seconds(5)
   */
  readonly flushInterval?: Duration.Duration;

  /**
   * Maximum number of events to queue.
   * @default 1000
   */
  readonly queueCapacity?: number;

  /**
   * Strategy when queue is full.
   * @default "dropping"
   */
  readonly queueStrategy?: QueueStrategy;

  /**
   * Number of retry attempts for failed sends.
   * @default 3
   */
  readonly retryAttempts?: number;

  /**
   * Custom retry schedule. If not provided, uses exponential backoff with jitter.
   */
  readonly retrySchedule?: Schedule.Schedule<unknown, unknown>;

  /**
   * Timeout for graceful shutdown.
   * @default Duration.seconds(30)
   */
  readonly shutdownTimeout?: Duration.Duration;

  /**
   * Global metadata added to all events.
   */
  readonly metadata?: Record<string, unknown>;

  /**
   * Callback for transport errors.
   * Called after all retries are exhausted.
   */
  readonly onError?: (error: TransportError, events: readonly Event[]) => void;
}

/**
 * Default configuration values.
 *
 * @since 1.0.0
 */
export const defaults = {
  batchSize: 10,
  flushInterval: Duration.seconds(5),
  queueCapacity: 1000,
  queueStrategy: "dropping" as const,
  retryAttempts: 3,
  shutdownTimeout: Duration.seconds(30),
} satisfies Required<
  Omit<Config, "generateId" | "metadata" | "onError" | "retrySchedule">
>;

/**
 * Resolves a partial config with defaults.
 *
 * @since 1.0.0
 */
export const resolve = (
  config?: Config
): Required<
  Omit<Config, "generateId" | "metadata" | "onError" | "retrySchedule">
> &
  Config => ({
  ...defaults,
  ...config,
});
