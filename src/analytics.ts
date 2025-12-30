import { Context, Effect, Layer, ManagedRuntime, Option } from "effect";
import {
  type AnalyticsDestination,
  AnalyticsDestinationInternal,
  makeDestination,
} from "./destination.js";
import type { Event, Identify } from "./schema.js";

/**
 * @since 1.0.0
 * @category models
 */
export interface Analytics {
  readonly track: (event: Event) => Effect.Effect<void>;
  readonly identify: (identify: Identify) => Effect.Effect<void>;
}

/**
 * @internal
 */
export const Analytics = Context.GenericTag<Analytics>(
  "@trashlytics/Analytics"
);

/**
 * @internal
 */
export const layer = Layer.effect(
  Analytics,
  Effect.gen(function* () {
    return {
      track: (event) =>
        Effect.logDebug(`Tracking event: ${event.name}`).pipe(
          Effect.zipRight(
            Effect.serviceOption(AnalyticsDestinationInternal).pipe(
              Effect.flatMap((opt) =>
                Option.isSome(opt)
                  ? opt.value.track(event).pipe(Effect.ignore)
                  : Effect.void
              )
            )
          )
        ),
      identify: (identify) =>
        Effect.logDebug(`Identifying user: ${identify.userId}`).pipe(
          Effect.zipRight(
            Effect.serviceOption(AnalyticsDestinationInternal).pipe(
              Effect.flatMap((opt) =>
                Option.isSome(opt)
                  ? opt.value.identify(identify).pipe(Effect.ignore)
                  : Effect.void
              )
            )
          )
        ),
    };
  })
);

/**
 * @since 1.0.0
 * @category classes
 */
export class Trashlytics {
  private readonly runtime: ManagedRuntime.ManagedRuntime<Analytics, never>;

  constructor(
    options: {
      destinations?: AnalyticsDestination[];
      layer?: Layer.Layer<Analytics, never, never>;
    } = {}
  ) {
    if (options.layer) {
      this.runtime = ManagedRuntime.make(options.layer);
    } else {
      let destLayer: Layer.Layer<never, never, never> = Layer.empty;
      if (options.destinations && options.destinations.length > 0) {
        const layers = options.destinations.map((d) =>
          Layer.succeed(AnalyticsDestinationInternal, makeDestination(d))
        );
        destLayer = Layer.mergeAll(
          layers[0] as Layer.Layer<never, never, never>,
          ...(layers.slice(1) as Layer.Layer<never, never, never>[])
        );
      }

      this.runtime = ManagedRuntime.make(
        layer.pipe(Layer.provide(destLayer)) as Layer.Layer<Analytics, never>
      );
    }
  }

  /**
   * Track an event.
   */
  track(event: Event): Promise<void> {
    return this.runtime.runPromise(
      Effect.flatMap(Analytics, (a) => a.track(event))
    );
  }

  /**
   * Identify a user.
   */
  identify(identify: Identify): Promise<void> {
    return this.runtime.runPromise(
      Effect.flatMap(Analytics, (a) => a.identify(identify))
    );
  }
}
