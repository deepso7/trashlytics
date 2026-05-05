import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createTracker, event, type TrackedEvent } from "../src/index";

const events = {
  signup: event("user.signup", {
    userId: Schema.String,
    plan: Schema.Literals(["free", "pro"]),
  }),
  purchase: event("purchase.completed", {
    orderId: Schema.String,
    total: Schema.Number,
  }),
};

if (false) {
  const tracker = createTracker({ events, sink: () => undefined });

  tracker.track("signup", { userId: "u_1", plan: "free" });

  // @ts-expect-error invalid literal payload
  tracker.track("signup", { userId: "u_1", plan: "enterprise" });

  // @ts-expect-error missing required payload field
  tracker.track("purchase", { orderId: "o_1" });
}

describe("tracker", () => {
  it("sends typed batches", async () => {
    const batches: Array<ReadonlyArray<TrackedEvent<typeof events>>> = [];
    const tracker = createTracker({
      events,
      flushInterval: 0,
      sink: async (batch) => {
        for (const item of batch) {
          if (item.key === "signup") {
            const plan: "free" | "pro" = item.payload.plan;
            expect(plan).toBe("pro");
          }

          if (item.key === "purchase") {
            const total: number = item.payload.total;
            expect(total).toBe(20);
          }
        }

        batches.push(batch);
      },
    });

    tracker.track("signup", { userId: "u_1", plan: "pro" });
    tracker.track("purchase", { orderId: "o_1", total: 20 });

    await tracker.flush();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject([
      {
        key: "signup",
        name: "user.signup",
        payload: { userId: "u_1", plan: "pro" },
      },
      {
        key: "purchase",
        name: "purchase.completed",
        payload: { orderId: "o_1", total: 20 },
      },
    ]);
  });

  it("does not queue invalid payloads", async () => {
    const errors: Array<unknown> = [];
    const batches: Array<ReadonlyArray<TrackedEvent<typeof events>>> = [];
    const tracker = createTracker({
      events,
      flushInterval: 0,
      onError: (error) => errors.push(error),
      sink: async (batch) => {
        batches.push(batch);
      },
    });

    tracker.track("signup", { userId: "u_1", plan: "enterprise" } as never);

    await tracker.flush();

    expect(errors).toHaveLength(1);
    expect(batches).toHaveLength(0);
  });

  it("accepts full v4 schemas as event definitions", async () => {
    const schemaEvents = {
      identified: event(
        "user.identified",
        Schema.Struct({ userId: Schema.String })
      ),
    };
    const batches: Array<ReadonlyArray<TrackedEvent<typeof schemaEvents>>> = [];
    const tracker = createTracker({
      events: schemaEvents,
      flushInterval: 0,
      sink: async (batch) => {
        batches.push(batch);
      },
    });

    tracker.track("identified", { userId: "u_1" });

    await tracker.flush();

    expect(batches[0]).toMatchObject([
      {
        key: "identified",
        name: "user.identified",
        payload: { userId: "u_1" },
      },
    ]);
  });

  it("splits flushes by batch size", async () => {
    const batches: Array<ReadonlyArray<TrackedEvent<typeof events>>> = [];
    const tracker = createTracker({
      events,
      batchSize: 2,
      flushInterval: 0,
      sink: async (batch) => {
        batches.push([...batch]);
      },
    });

    tracker.track("signup", { userId: "u_1", plan: "free" });
    tracker.track("signup", { userId: "u_2", plan: "pro" });
    tracker.track("purchase", { orderId: "o_1", total: 42 });

    await tracker.flush();

    expect(batches.map((batch) => batch.length)).toEqual([2, 1]);
  });

  it("retries failed deliveries", async () => {
    let attempts = 0;
    const tracker = createTracker({
      events,
      flushInterval: 0,
      retries: { attempts: 2, delay: 1, factor: 1 },
      sink: async () => {
        attempts += 1;

        if (attempts < 3) {
          throw new Error("not yet");
        }
      },
    });

    await tracker.trackNow("signup", { userId: "u_1", plan: "free" });

    expect(attempts).toBe(3);
  });

  it("flushes remaining events on shutdown", async () => {
    const batches: Array<ReadonlyArray<TrackedEvent<typeof events>>> = [];
    const tracker = createTracker({
      events,
      flushInterval: 10_000,
      sink: async (batch) => {
        batches.push(batch);
      },
    });

    tracker.track("signup", { userId: "u_1", plan: "free" });

    await tracker.shutdown();

    expect(batches).toHaveLength(1);
  });
});
