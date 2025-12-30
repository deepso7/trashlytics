import type { AnalyticsDestination } from "./destination.js";

/**
 * @since 1.0.0
 * @category models
 */
export interface HttpDestinationOptions {
  readonly url: string;
  readonly headers?: Record<string, string>;
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const makeHttp = (
  options: HttpDestinationOptions
): AnalyticsDestination => ({
  name: "HTTP",
  track: async (event) => {
    await fetch(options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: JSON.stringify(event),
    });
  },
  identify: async (identify) => {
    await fetch(options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: JSON.stringify(identify),
    });
  },
});
