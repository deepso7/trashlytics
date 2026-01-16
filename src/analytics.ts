import type { AnalyticsConfig } from "./config";

export interface Analytics<T = unknown> {
  /**
   * Track an event (fire-and-forget).
   * The event is queued and will be sent in the next batch.
   */
  track(payload: T): void;

  /**
   * Track an event and wait for it to be queued.
   */
  trackAsync(payload: T): Promise<void>;

  /**
   * Flush all queued events immediately.
   * Waits for all retries to complete.
   */
  flush(): Promise<void>;

  /**
   * Gracefully shutdown the tracker.
   * Flushes remaining events and stops the background fiber.
   */
  shutdown(): Promise<void>;
}

export const createAnalytics = <T = unknown>(
  config: AnalyticsConfig<T>
): Analytics<T> => {};
