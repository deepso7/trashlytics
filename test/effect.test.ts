import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  createTracker,
  event,
  SinkDeliveryError,
  type TrackedEvent,
} from "../src/effect";

const events = {
  signup: event("user.signup", {
    userId: Schema.String,
    plan: Schema.Literals(["free", "pro"]),
  }),
};

describe("effect tracker", () => {
  it("exposes Effect-native tracker operations", async () => {
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    const tracker = createTracker({
      events,
      sink: (batch) =>
        Effect.sync(() => {
          batches.push(batch);
        }),
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* tracker.track("signup", { userId: "u_1", plan: "free" });
        yield* tracker.flush();
      })
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject([
      {
        key: "signup",
        name: "user.signup",
        payload: { userId: "u_1", plan: "free" },
      },
    ]);
  });

  it("retries Effect sink failures", async () => {
    let attempts = 0;
    const tracker = createTracker({
      events,
      retries: { attempts: 2, delay: 1, factor: 1 },
      sink: () =>
        Effect.sync(() => {
          attempts += 1;
        }).pipe(
          Effect.andThen(() =>
            attempts < 3
              ? Effect.fail(new SinkDeliveryError({ cause: "not yet" }))
              : Effect.void
          )
        ),
    });

    await Effect.runPromise(
      tracker.trackNow("signup", { userId: "u_1", plan: "free" })
    );

    expect(attempts).toBe(3);
  });

  it("flushes queued events after the flush interval", async () => {
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    const tracker = createTracker({
      events,
      flushInterval: 1,
      sink: (batch) =>
        Effect.sync(() => {
          batches.push([...batch]);
        }),
    });

    await Effect.runPromise(
      tracker.track("signup", { userId: "u_1", plan: "free" })
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await Effect.runPromise(tracker.shutdown());

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject([
      {
        key: "signup",
        name: "user.signup",
        payload: { userId: "u_1", plan: "free" },
      },
    ]);
  });

  it("does not interrupt an in-flight interval delivery on shutdown", async () => {
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    let deliveryStarted!: () => void;
    let resumeDelivery!: (effect: Effect.Effect<void>) => void;
    let shutdownCompleted = false;
    let deliveryInterrupted = false;
    const deliveryStartedPromise = new Promise<void>((resolve) => {
      deliveryStarted = resolve;
    });
    const tracker = createTracker({
      events,
      flushInterval: 1,
      sink: (batch) =>
        Effect.callback<void>((resume) => {
          batches.push([...batch]);
          resumeDelivery = resume;
          deliveryStarted();

          return Effect.sync(() => {
            deliveryInterrupted = true;
          });
        }),
    });

    await Effect.runPromise(
      tracker.track("signup", { userId: "u_1", plan: "free" })
    );
    await deliveryStartedPromise;

    const shutdownPromise = Effect.runPromise(tracker.shutdown()).then(() => {
      shutdownCompleted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shutdownCompleted).toBe(false);
    expect(deliveryInterrupted).toBe(false);

    resumeDelivery(Effect.void);
    await shutdownPromise;

    expect(deliveryInterrupted).toBe(false);
    expect(batches).toHaveLength(1);
  });
});
