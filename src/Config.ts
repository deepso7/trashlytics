/**
 * Configuration types and defaults.
 *
 * @since 1.0.0
 */
import type { Event } from "./event.js";
import type { Transport, TransportError } from "./transport.js";

/**
 * Queue overflow strategy.
 *
 * - `bounded`: Back-pressure (blocks when full)
 * - `dropping`: Drops new events when full
 * - `sliding`: Drops oldest events when full
 */
export type QueueStrategy = "bounded" | "dropping" | "sliding";

/**
 * Configuration for the Tracker.
 */
export interface TrackerConfig {
  /** Array of transports to send events to */
  readonly transports: readonly Transport[];

  /**
   * Custom ID generator for events.
   * If not provided, uses crypto.randomUUID or a fallback.
   */
  readonly generateId?: () => string;

  /**
   * Number of events to batch before sending.
   * @default 10
   */
  readonly batchSize?: number;

  /**
   * Maximum time (ms) to wait before flushing events.
   * @default 5000
   */
  readonly flushIntervalMs?: number;

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
   * Base delay (ms) for exponential backoff.
   * @default 1000
   */
  readonly retryDelayMs?: number;

  /**
   * Timeout (ms) for graceful shutdown.
   * @default 30000
   */
  readonly shutdownTimeoutMs?: number;

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
 */
export const defaults = {
  batchSize: 10,
  flushIntervalMs: 5000,
  queueCapacity: 1000,
  queueStrategy: "dropping" as const,
  retryAttempts: 3,
  retryDelayMs: 1000,
  shutdownTimeoutMs: 30_000,
};

/**
 * Resolved configuration with all defaults applied.
 */
export type ResolvedConfig = Required<
  Omit<TrackerConfig, "generateId" | "metadata" | "onError">
> &
  Pick<TrackerConfig, "generateId" | "metadata" | "onError">;

/**
 * Resolves a partial config with defaults.
 */
export const resolveConfig = (config: TrackerConfig): ResolvedConfig => ({
  ...defaults,
  ...config,
  transports: config.transports,
});
