/**
 * Logger - Custom logging abstraction for trashlytics.
 *
 * Allows enabling/disabling console output from the library.
 *
 * @example
 * ```ts
 * import { createTracker, consoleLogger, noopLogger } from "trashlytics"
 *
 * // Enable logging (default)
 * const tracker = createTracker({
 *   transports: [...],
 *   logger: consoleLogger,
 * })
 *
 * // Disable all logging
 * const silentTracker = createTracker({
 *   transports: [...],
 *   logger: noopLogger,
 * })
 *
 * // Custom logger
 * const tracker = createTracker({
 *   transports: [...],
 *   logger: {
 *     debug: (msg) => myCustomLogger.debug("[trashlytics]", msg),
 *     info: (msg) => myCustomLogger.info("[trashlytics]", msg),
 *     warn: (msg) => myCustomLogger.warn("[trashlytics]", msg),
 *     error: (msg) => myCustomLogger.error("[trashlytics]", msg),
 *   },
 * })
 * ```
 *
 * @since 1.0.0
 */

/**
 * Log levels supported by the logger.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Logger interface for customizable logging.
 */
export interface Logger {
  /**
   * Log a debug message.
   */
  readonly debug: (message: string, ...args: unknown[]) => void;

  /**
   * Log an info message.
   */
  readonly info: (message: string, ...args: unknown[]) => void;

  /**
   * Log a warning message.
   */
  readonly warn: (message: string, ...args: unknown[]) => void;

  /**
   * Log an error message.
   */
  readonly error: (message: string, ...args: unknown[]) => void;
}

/**
 * A logger that outputs to the console.
 * This is the default logger.
 */
export const consoleLogger: Logger = {
  debug: (message, ...args) => {
    if (typeof console !== "undefined" && console.debug) {
      console.debug(`[trashlytics] ${message}`, ...args);
    }
  },
  info: (message, ...args) => {
    if (typeof console !== "undefined" && console.info) {
      console.info(`[trashlytics] ${message}`, ...args);
    }
  },
  warn: (message, ...args) => {
    if (typeof console !== "undefined" && console.warn) {
      console.warn(`[trashlytics] ${message}`, ...args);
    }
  },
  error: (message, ...args) => {
    if (typeof console !== "undefined" && console.error) {
      console.error(`[trashlytics] ${message}`, ...args);
    }
  },
};

/**
 * A logger that does nothing.
 * Use this to silence all library logging.
 */
export const noopLogger: Logger = {
  debug: () => {
    // intentionally empty
  },
  info: () => {
    // intentionally empty
  },
  warn: () => {
    // intentionally empty
  },
  error: () => {
    // intentionally empty
  },
};

/**
 * Create a logger that only logs messages at or above the specified level.
 *
 * @example
 * ```ts
 * import { createMinLevelLogger } from "trashlytics"
 *
 * // Only log warnings and errors
 * const logger = createMinLevelLogger("warn")
 * ```
 */
export const createMinLevelLogger = (minLevel: LogLevel): Logger => {
  const levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const minOrdinal = levels[minLevel];

  const shouldLog = (level: LogLevel): boolean => levels[level] >= minOrdinal;

  return {
    debug: (message, ...args) => {
      if (shouldLog("debug")) {
        consoleLogger.debug(message, ...args);
      }
    },
    info: (message, ...args) => {
      if (shouldLog("info")) {
        consoleLogger.info(message, ...args);
      }
    },
    warn: (message, ...args) => {
      if (shouldLog("warn")) {
        consoleLogger.warn(message, ...args);
      }
    },
    error: (message, ...args) => {
      if (shouldLog("error")) {
        consoleLogger.error(message, ...args);
      }
    },
  };
};
