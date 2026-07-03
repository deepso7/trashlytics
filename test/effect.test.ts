import { Effect, Schema } from "effect";
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
    userId: Schema.String,
    plan: Schema.Literals(["free", "pro"]),
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
          const tracker = yield* make({ events, sink, flushInterval: 0 });

          yield* tracker.track("signup", { userId: "u_1", plan: "free" });
          yield* tracker.flush;
        })
      )
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

  it("fails track with EventValidationError on invalid payloads", async () => {
    const { sink } = collectingSink();

    const error = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({ events, sink, flushInterval: 0 });

          return yield* tracker
            .track("signup", { userId: "u_1", plan: "enterprise" } as never)
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
            sink,
            flushInterval: 0,
            retry: { attempts: 2, delay: 1, factor: 1 },
          });

          yield* tracker.trackNow("signup", { userId: "u_1", plan: "free" });
        })
      )
    );

    expect(attempts).toBe(3);
  });

  it("flushes remaining events when the scope closes", async () => {
    const { batches, sink } = collectingSink();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracker = yield* make({
            events,
            sink,
            flushInterval: 10_000,
          });

          yield* tracker.track("signup", { userId: "u_1", plan: "free" });

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
          const tracker = yield* make({ events, sink, flushInterval: 0 });

          yield* tracker.track("signup", { userId: "u_1", plan: "free" });
          yield* tracker.track("signup", { userId: "u_2", plan: "pro" });

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
          const tracker = yield* make({ events, sink, flushInterval: 5 });

          yield* tracker.track("signup", { userId: "u_1", plan: "free" });

          yield* Effect.sleep(50);
        })
      )
    );

    expect(batches).toHaveLength(1);
  });
});
