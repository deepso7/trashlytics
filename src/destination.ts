import { Context, Effect } from "effect";
import type { Event, Identify } from "./schema.js";

/**
 * @since 1.0.0
 * @category models
 */
export interface AnalyticsDestination {
  readonly name: string;
  readonly track: (event: Event) => Promise<void> | void;
  readonly identify: (identify: Identify) => Promise<void> | void;
}

/**
 * @internal
 */
export interface AnalyticsDestinationInternal {
  readonly name: string;
  readonly track: (event: Event) => Effect.Effect<void, unknown>;
  readonly identify: (identify: Identify) => Effect.Effect<void, unknown>;
}

/**
 * @internal
 */
export const AnalyticsDestinationInternal =
  Context.GenericTag<AnalyticsDestinationInternal>(
    "@trashlytics/AnalyticsDestinationInternal"
  );

/**
 * @internal
 */
export const makeDestination = (
  destination: AnalyticsDestination
): AnalyticsDestinationInternal =>
  AnalyticsDestinationInternal.of({
    name: destination.name,
    track: (event) => Effect.promise(async () => destination.track(event)),
    identify: (identify) =>
      Effect.promise(async () => destination.identify(identify)),
  });
