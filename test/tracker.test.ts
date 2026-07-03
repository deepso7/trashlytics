import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  createTracker,
  event,
  type StandardResult,
  type StandardSchemaV1,
  type TrackedEvent,
} from "../src/index";

const events = {
  signup: event("user.signup", {
    userId: Schema.String,
    plan: Schema.Literals(["free", "pro"]),
  }),
  purchase: event("purchase.completed", {
    orderId: Schema.String,
    total: Schema.Number,
  }),
  pageview: event("page.viewed"),
};

const waitFor = async (predicate: () => boolean, timeout = 1000) => {
  const start = Date.now();

  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error("condition not met in time");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("tracker", () => {
  it("sends typed batches", async () => {
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    await using tracker = createTracker({
      events,
      flushInterval: 0,
      sink: (batch) => {
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

  it("tracks payload-less events", async () => {
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    await using tracker = createTracker({
      events,
      flushInterval: 0,
      sink: (batch) => {
        batches.push(batch);
      },
    });

    tracker.track("pageview");

    await tracker.flush();

    expect(batches[0]).toMatchObject([
      { key: "pageview", name: "page.viewed" },
    ]);
  });

  it("does not queue invalid payloads", async () => {
    const errors: unknown[] = [];
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    await using tracker = createTracker({
      events,
      flushInterval: 0,
      onError: (error) => errors.push(error),
      sink: (batch) => {
        batches.push(batch);
      },
    });

    tracker.track("signup", { userId: "u_1", plan: "enterprise" } as never);

    await waitFor(() => errors.length === 1);
    await tracker.flush();

    expect(batches).toHaveLength(0);
  });

  it("accepts full effect schemas as event definitions", async () => {
    const schemaEvents = {
      identified: event(
        "user.identified",
        Schema.Struct({ userId: Schema.String })
      ),
    };
    const batches: (readonly TrackedEvent<typeof schemaEvents>[])[] = [];
    await using tracker = createTracker({
      events: schemaEvents,
      flushInterval: 0,
      sink: (batch) => {
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

  it("accepts standard schemas (zod-style) as event definitions", async () => {
    const userIdSchema: StandardSchemaV1<unknown, { userId: string }> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value): StandardResult<{ userId: string }> => {
          if (
            typeof value === "object" &&
            value !== null &&
            "userId" in value &&
            typeof value.userId === "string"
          ) {
            return { value: { userId: value.userId } };
          }

          return { issues: [{ message: "expected { userId: string }" }] };
        },
      },
    };

    const standardEvents = {
      identified: event("user.identified", userIdSchema),
    };
    const errors: unknown[] = [];
    const batches: (readonly TrackedEvent<typeof standardEvents>[])[] = [];
    await using tracker = createTracker({
      events: standardEvents,
      flushInterval: 0,
      onError: (error) => errors.push(error),
      sink: (batch) => {
        batches.push(batch);
      },
    });

    tracker.track("identified", { userId: "u_1" });
    tracker.track("identified", { userId: 42 } as never);

    await waitFor(() => errors.length === 1);
    await tracker.flush();

    expect(batches[0]).toMatchObject([
      { key: "identified", payload: { userId: "u_1" } },
    ]);
  });

  it("merges tracker context into event meta", async () => {
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    await using tracker = createTracker({
      events,
      flushInterval: 0,
      context: () => ({ sessionId: "s_1", source: "context" }),
      sink: (batch) => {
        batches.push(batch);
      },
    });

    tracker.track(
      "signup",
      { userId: "u_1", plan: "free" },
      { meta: { source: "event" } }
    );

    await tracker.flush();

    expect(batches[0]?.[0]?.meta).toEqual({
      sessionId: "s_1",
      source: "event",
    });
  });

  it("delivers in the background when the batch size is reached", async () => {
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    await using tracker = createTracker({
      events,
      batchSize: 2,
      flushInterval: 0,
      sink: (batch) => {
        batches.push([...batch]);
      },
    });

    tracker.track("signup", { userId: "u_1", plan: "free" });
    tracker.track("signup", { userId: "u_2", plan: "pro" });

    await waitFor(() => batches.length === 1);

    expect(batches[0]).toHaveLength(2);
  });

  it("splits flushes by batch size", async () => {
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    await using tracker = createTracker({
      events,
      batchSize: 2,
      flushInterval: 1_000_000,
      sink: (batch) => {
        batches.push([...batch]);
      },
    });

    tracker.track("signup", { userId: "u_1", plan: "free" });

    await tracker.flush();

    tracker.track("signup", { userId: "u_2", plan: "pro" });
    tracker.track("purchase", { orderId: "o_1", total: 42 });
    tracker.track("purchase", { orderId: "o_2", total: 7 });

    await waitFor(() => batches.length >= 2);
    await tracker.flush();

    expect(batches.flat()).toHaveLength(4);
    expect(batches.every((batch) => batch.length <= 2)).toBe(true);
  });

  it("retries failed deliveries", async () => {
    let attempts = 0;
    await using tracker = createTracker({
      events,
      flushInterval: 0,
      retry: { attempts: 2, delay: 1, factor: 1 },
      sink: () => {
        attempts += 1;

        if (attempts < 3) {
          throw new Error("not yet");
        }
      },
    });

    await tracker.trackNow("signup", { userId: "u_1", plan: "free" });

    expect(attempts).toBe(3);
  });

  it("flushes remaining events on close", async () => {
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    const tracker = createTracker({
      events,
      flushInterval: 10_000,
      sink: (batch) => {
        batches.push(batch);
      },
    });

    tracker.track("signup", { userId: "u_1", plan: "free" });

    await tracker.close();

    expect(batches).toHaveLength(1);
  });

  it("reports interval flush failures with the failed batch", async () => {
    const errors: [unknown, unknown][] = [];
    const tracker = createTracker({
      events,
      flushInterval: 1,
      onError: (error, batch) => errors.push([error, batch]),
      sink: () => {
        throw new Error("delivery down");
      },
    });

    tracker.track("signup", { userId: "u_1", plan: "free" });

    await waitFor(() => errors.length >= 1);
    await tracker.close();

    expect(errors[0]?.[1]).toMatchObject([{ key: "signup" }]);
  });

  it("reports tracking after close", async () => {
    const errors: unknown[] = [];
    const tracker = createTracker({
      events,
      flushInterval: 0,
      onError: (error) => errors.push(error),
      sink: () => {
        // Discard.
      },
    });

    await tracker.close();

    tracker.track("signup", { userId: "u_1", plan: "free" });

    await waitFor(() => errors.length === 1);
  });
});
