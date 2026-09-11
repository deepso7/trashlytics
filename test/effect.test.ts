import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Latch, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import {
  EventValidationError,
  event,
  make,
  type Sink,
  SinkError,
  type TrackedEvent,
} from "../src/effect";

const events = {
  signup: event("user.signup", {
    plan: Schema.Literals(["free", "pro"]),
    userId: Schema.String,
  }),
};

const collectingSink = () => {
  const batches: (readonly TrackedEvent<typeof events>[])[] = [];
  const sink: Sink<typeof events> = (batch) =>
    Effect.sync(() => {
      batches.push(batch);
    });

  return { batches, sink };
};

describe("effect tracker", () => {
  it.effect("exposes Effect-native tracker operations", () =>
    Effect.gen(function* () {
      const { batches, sink } = collectingSink();
      const tracker = yield* make({ events, flushInterval: 0, sink });

      yield* tracker.track("signup", { plan: "free", userId: "u_1" });
      yield* tracker.flush;

      assert.strictEqual(batches.length, 1);
      assert.strictEqual(batches[0]?.[0]?.key, "signup");
      assert.strictEqual(batches[0]?.[0]?.name, "user.signup");
      assert.deepStrictEqual(batches[0]?.[0]?.payload, {
        plan: "free",
        userId: "u_1",
      });
    })
  );

  it.effect("fails track with EventValidationError on invalid payloads", () =>
    Effect.gen(function* () {
      const { sink } = collectingSink();
      const tracker = yield* make({ events, flushInterval: 0, sink });

      const error = yield* tracker
        .track("signup", { plan: "enterprise", userId: "u_1" } as never)
        .pipe(Effect.flip);

      assert.instanceOf(error, EventValidationError);
      if (error instanceof EventValidationError) {
        assert.strictEqual(error.key, "signup");
      }
    })
  );

  // The retry schedule is clock-driven, so this runs against real services
  // with a 1ms delay rather than adjusting TestClock between attempts.
  it.live("retries sink failures", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const sink: Sink<typeof events, SinkError> = () =>
        Effect.suspend(() => {
          attempts += 1;

          return attempts < 3
            ? Effect.fail(new SinkError({ cause: "not yet" }))
            : Effect.void;
        });

      const tracker = yield* make({
        events,
        flushInterval: 0,
        retry: { attempts: 2, delay: 1, factor: 1 },
        sink,
      });

      yield* tracker.trackNow("signup", { plan: "free", userId: "u_1" });

      assert.strictEqual(attempts, 3);
    })
  );

  it.effect(
    "fails trackNow with the typed sink error even when onError throws",
    () =>
      Effect.gen(function* () {
        const tracker = yield* make({
          events,
          flushInterval: 0,
          onError: () => {
            throw new Error("observer boom");
          },
          sink: () => Effect.fail(new SinkError({ cause: "down" })),
        });

        const error = yield* tracker
          .trackNow("signup", { plan: "free", userId: "u_1" })
          .pipe(Effect.flip);

        assert.instanceOf(error, SinkError);
      })
  );

  it.effect("does not drop an in-flight batch when the scope closes", () =>
    Effect.gen(function* () {
      const delivered: TrackedEvent<typeof events>[] = [];
      const sinkStarted = yield* Latch.make();
      const releaseDelivery = yield* Latch.make();

      // Own scope so the test controls when close begins; the sink blocks on
      // releaseDelivery so close starts while delivery is mid-flight.
      const scope = yield* Scope.make();
      const tracker = yield* make({
        batchSize: 1,
        events,
        flushInterval: 0,
        sink: (batch) =>
          Effect.gen(function* () {
            yield* sinkStarted.open;
            yield* releaseDelivery.await;
            delivered.push(...batch);
          }),
      }).pipe(Scope.provide(scope));

      yield* tracker.track("signup", { plan: "free", userId: "u_1" });
      yield* sinkStarted.await;

      // Close while the sink is blocked, then assert it is actually waiting on
      // the in-flight delivery rather than having dropped the batch.
      const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
      yield* Effect.yieldNow;

      assert.strictEqual(delivered.length, 0, "delivery finished too early");
      assert.isUndefined(
        closing.pollUnsafe(),
        "close did not wait for the in-flight delivery"
      );

      yield* releaseDelivery.open;
      yield* Fiber.join(closing);

      assert.strictEqual(delivered.length, 1);
    })
  );

  it.effect("flushes remaining events when the scope closes", () =>
    Effect.gen(function* () {
      const { batches, sink } = collectingSink();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({
            events,
            flushInterval: 10_000,
            sink,
          });

          yield* tracker.track("signup", { plan: "free", userId: "u_1" });

          assert.strictEqual(batches.length, 0);
        })
      );

      assert.strictEqual(batches.length, 1);
    })
  );

  it.effect("reports queue size", () =>
    Effect.gen(function* () {
      const { sink } = collectingSink();
      const tracker = yield* make({ events, flushInterval: 0, sink });

      yield* tracker.track("signup", { plan: "free", userId: "u_1" });
      yield* tracker.track("signup", { plan: "pro", userId: "u_2" });

      assert.strictEqual(yield* tracker.size, 2);
    })
  );

  it.effect("delivers on the flush interval without an explicit flush", () =>
    Effect.gen(function* () {
      const { batches, sink } = collectingSink();
      const tracker = yield* make({ events, flushInterval: 5, sink });

      yield* tracker.track("signup", { plan: "free", userId: "u_1" });

      // No explicit flush: advancing the clock past the interval must be
      // enough for the background worker to drain the queue on its own.
      yield* TestClock.adjust("5 millis");

      assert.strictEqual(batches.length, 1);
      assert.strictEqual(yield* tracker.size, 0);
    })
  );
});
