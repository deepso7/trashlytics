import { Effect, Latch, Schema } from "effect";
import { describe, expect, it } from "vitest";
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
  it("exposes Effect-native tracker operations", async () => {
    const { batches, sink } = collectingSink();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({ events, flushInterval: 0, sink });

          yield* tracker.track("signup", { plan: "free", userId: "u_1" });
          yield* tracker.flush;
        })
      )
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject([
      {
        key: "signup",
        name: "user.signup",
        payload: { plan: "free", userId: "u_1" },
      },
    ]);
  });

  it("fails track with EventValidationError on invalid payloads", async () => {
    const { sink } = collectingSink();

    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({ events, flushInterval: 0, sink });

          return yield* tracker
            .track("signup", { plan: "enterprise", userId: "u_1" } as never)
            .pipe(Effect.flip);
        })
      )
    );

    expect(error).toBeInstanceOf(EventValidationError);
    expect(error._tag).toBe("EventValidationError");
    expect(error._tag === "EventValidationError" && error.key).toBe("signup");
  });

  it("retries sink failures", async () => {
    let attempts = 0;
    const sink: Sink<typeof events, SinkError> = () =>
      Effect.suspend(() => {
        attempts += 1;

        return attempts < 3
          ? Effect.fail(new SinkError({ cause: "not yet" }))
          : Effect.void;
      });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({
            events,
            flushInterval: 0,
            retry: { attempts: 2, delay: 1, factor: 1 },
            sink,
          });

          yield* tracker.trackNow("signup", { plan: "free", userId: "u_1" });
        })
      )
    );

    expect(attempts).toBe(3);
  });

  it("fails trackNow with the typed sink error even when onError throws", async () => {
    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({
            events,
            flushInterval: 0,
            onError: () => {
              throw new Error("observer boom");
            },
            sink: () => Effect.fail(new SinkError({ cause: "down" })),
          });

          return yield* tracker
            .trackNow("signup", { plan: "free", userId: "u_1" })
            .pipe(Effect.flip);
        })
      )
    );

    expect(error).toBeInstanceOf(SinkError);
  });

  it("does not drop an in-flight batch when the scope closes", async () => {
    const delivered: TrackedEvent<typeof events>[] = [];
    const sinkStarted = Latch.makeUnsafe(false);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({
            batchSize: 1,
            events,
            flushInterval: 0,
            sink: (batch) =>
              Effect.gen(function* () {
                sinkStarted.openUnsafe();
                yield* Effect.sleep(30);
                delivered.push(...batch);
              }),
          });

          yield* tracker.track("signup", { plan: "free", userId: "u_1" });
          // Leave the scope while the background worker is mid-delivery.
          yield* sinkStarted.await;
        })
      )
    );

    expect(delivered).toHaveLength(1);
  });

  it("flushes remaining events when the scope closes", async () => {
    const { batches, sink } = collectingSink();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({
            events,
            flushInterval: 10_000,
            sink,
          });

          yield* tracker.track("signup", { plan: "free", userId: "u_1" });

          expect(batches).toHaveLength(0);
        })
      )
    );

    expect(batches).toHaveLength(1);
  });

  it("reports queue size", async () => {
    const { sink } = collectingSink();

    const size = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({ events, flushInterval: 0, sink });

          yield* tracker.track("signup", { plan: "free", userId: "u_1" });
          yield* tracker.track("signup", { plan: "pro", userId: "u_2" });

          return yield* tracker.size;
        })
      )
    );

    expect(size).toBe(2);
  });

  it("delivers on the flush interval without an explicit flush", async () => {
    const { batches, sink } = collectingSink();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({ events, flushInterval: 5, sink });

          yield* tracker.track("signup", { plan: "free", userId: "u_1" });

          yield* Effect.sleep(50);
        })
      )
    );

    expect(batches).toHaveLength(1);
  });
});
