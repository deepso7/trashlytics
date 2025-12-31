/**
 * Configuration types and defaults.
 *
 * @since 1.0.0
 */
import type { Event, EventMap, EventUnion } from "./event.js";
import type { Logger } from "./logger.js";
import { consoleLogger } from "./logger.js";
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
 *
 * @template E - Event map type for typed events.
 */
export interface TrackerConfig<E extends EventMap> {
  /** Array of transports to send events to */
  readonly transports: readonly Transport<E>[];

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
  readonly onError?: (
    error: TransportError,
    events: readonly Event<EventUnion<E>>[]
  ) => void;

  /**
   * Custom logger for library output.
   * Use `noopLogger` to disable all logging.
   * @default consoleLogger
   */
  readonly logger?: Logger;
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
 *
 * @template E - Event map type for typed events.
 */
export type ResolvedConfig<E extends EventMap> = Required<
  Omit<TrackerConfig<E>, "generateId" | "metadata" | "onError" | "logger">
> &
  Pick<TrackerConfig<E>, "generateId" | "metadata" | "onError"> & {
    readonly logger: Logger;
  };

/**
 * Resolves a partial config with defaults.
 *
 * @template E - Event map type for typed events.
 */
export const resolveConfig = <E extends EventMap>(
  config: TrackerConfig<E>
): ResolvedConfig<E> => {
  return {
    batchSize: config.batchSize ?? defaults.batchSize,
    flushIntervalMs: config.flushIntervalMs ?? defaults.flushIntervalMs,
    queueCapacity: config.queueCapacity ?? defaults.queueCapacity,
    queueStrategy: config.queueStrategy ?? defaults.queueStrategy,
    retryAttempts: config.retryAttempts ?? defaults.retryAttempts,
    retryDelayMs: config.retryDelayMs ?? defaults.retryDelayMs,
    shutdownTimeoutMs: config.shutdownTimeoutMs ?? defaults.shutdownTimeoutMs,
    transports: config.transports,
    generateId: config.generateId,
    metadata: config.metadata,
    onError: config.onError,
    logger: config.logger ?? consoleLogger,
  };
};
