import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  createTracker,
  event,
  SinkError,
  type StandardResult,
  type StandardSchemaV1,
  type TrackedEvent,
  TrackerClosedError,
} from "../src/index";

const events = {
  pageview: event("page.viewed"),
  purchase: event("purchase.completed", {
    orderId: Schema.String,
    total: Schema.Number,
  }),
  signup: event("user.signup", {
    plan: Schema.Literals(["free", "pro"]),
    userId: Schema.String,
  }),
};

const waitFor = async (predicate: () => boolean, timeout = 1000) => {
  const start = Date.now();

  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error("condition not met in time");
    }

    // biome-ignore lint/performance/noAwaitInLoops: polling helper intentionally sleeps between checks.
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

    tracker.track("signup", { plan: "pro", userId: "u_1" });
    tracker.track("purchase", { orderId: "o_1", total: 20 });

    await tracker.flush();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject([
      {
        key: "signup",
        name: "user.signup",
        payload: { plan: "pro", userId: "u_1" },
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

    tracker.track("signup", { plan: "enterprise", userId: "u_1" } as never);

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
        vendor: "test",
        version: 1,
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
      context: () => ({ sessionId: "s_1", source: "context" }),
      events,
      flushInterval: 0,
      sink: (batch) => {
        batches.push(batch);
      },
    });

    tracker.track(
      "signup",
      { plan: "free", userId: "u_1" },
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
      batchSize: 2,
      events,
      flushInterval: 0,
      sink: (batch) => {
        batches.push([...batch]);
      },
    });

    tracker.track("signup", { plan: "free", userId: "u_1" });
    tracker.track("signup", { plan: "pro", userId: "u_2" });

    await waitFor(() => batches.length === 1);

    expect(batches[0]).toHaveLength(2);
  });

  it("splits flushes by batch size", async () => {
    const batches: (readonly TrackedEvent<typeof events>[])[] = [];
    await using tracker = createTracker({
      batchSize: 2,
      events,
      flushInterval: 1_000_000,
      sink: (batch) => {
        batches.push([...batch]);
      },
    });

    tracker.track("signup", { plan: "free", userId: "u_1" });

    await tracker.flush();

    tracker.track("signup", { plan: "pro", userId: "u_2" });
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

    await tracker.trackNow("signup", { plan: "free", userId: "u_1" });

    expect(attempts).toBe(3);
  });

  it("reports trackNow delivery failures to onError", async () => {
    const errors: [unknown, unknown][] = [];
    await using tracker = createTracker({
      events,
      flushInterval: 0,
      onError: (error, batch) => errors.push([error, batch]),
      sink: () => {
        throw new Error("delivery down");
      },
    });

    await expect(
      tracker.trackNow("signup", { plan: "free", userId: "u_1" })
    ).rejects.toThrow();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.[1]).toMatchObject([{ key: "signup" }]);
  });

  it("close() stays bounded when the sink never settles", async () => {
    const errors: unknown[] = [];
    const tracker = createTracker({
      batchSize: 1,
      deliveryTimeout: 20,
      events,
      flushInterval: 0,
      onError: (error) => errors.push(error),
      sink: () =>
        new Promise<void>(() => {
          // Never settles.
        }),
    });

    tracker.track("signup", { plan: "free", userId: "u_1" });

    await tracker.close();

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toBeInstanceOf(SinkError);
    expect(String((errors[0] as SinkError).cause)).toContain(
      "did not complete within 20ms"
    );
  });

  it("reports queue size", async () => {
    await using tracker = createTracker({
      events,
      flushInterval: 0,
      sink: () => {
        // Discard.
      },
    });

    expect(tracker.size()).toBe(0);

    tracker.track("signup", { plan: "free", userId: "u_1" });
    await waitFor(() => tracker.size() === 1);

    await tracker.flush();

    expect(tracker.size()).toBe(0);
  });

  it("aborts the sink signal when a delivery times out", async () => {
    let observed: AbortSignal | undefined;
    const tracker = createTracker({
      batchSize: 1,
      deliveryTimeout: 20,
      events,
      flushInterval: 0,
      onError: () => {
        // Timeout is expected; assertions happen below.
      },
      sink: (_batch, signal) => {
        observed = signal;

        return new Promise<void>(() => {
          // Never settles; the timeout must abandon and abort it.
        });
      },
    });

    tracker.track("signup", { plan: "free", userId: "u_1" });

    await tracker.close();

    expect(observed?.aborted).toBe(true);
  });

  it("does not abort the sink signal on a successful delivery", async () => {
    let observed: AbortSignal | undefined;
    await using tracker = createTracker({
      events,
      flushInterval: 0,
      sink: (_batch, signal) => {
        observed = signal;
      },
    });

    tracker.track("signup", { plan: "free", userId: "u_1" });

    await tracker.flush();

    expect(observed).toBeInstanceOf(AbortSignal);
    expect(observed?.aborted).toBe(false);
  });

  it("does not drop an in-flight batch when closed mid-delivery", async () => {
    const delivered: TrackedEvent<typeof events>[] = [];
    let signalStarted = () => {
      // Reassigned below.
    };
    const sinkStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const tracker = createTracker({
      batchSize: 1,
      events,
      flushInterval: 0,
      sink: async (batch) => {
        signalStarted();
        await new Promise((resolve) => setTimeout(resolve, 30));
        delivered.push(...batch);
      },
    });

    tracker.track("signup", { plan: "free", userId: "u_1" });

    await sinkStarted;
    await tracker.close();

    expect(delivered).toHaveLength(1);
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

    tracker.track("signup", { plan: "free", userId: "u_1" });

    await tracker.close();

    expect(batches).toHaveLength(1);
  });

  it("waits for async validation before flush and close", async () => {
    const asyncSchema: StandardSchemaV1<unknown, { userId: string }> = {
      "~standard": {
        validate: async (value) => {
          await new Promise((resolve) => setTimeout(resolve, 20));

          return { value: value as { userId: string } };
        },
        vendor: "test",
        version: 1,
      },
    };

    const asyncEvents = { identified: event("user.identified", asyncSchema) };
    const batches: (readonly TrackedEvent<typeof asyncEvents>[])[] = [];
    const tracker = createTracker({
      events: asyncEvents,
      flushInterval: 0,
      sink: (batch) => {
        batches.push(batch);
      },
    });

    tracker.track("identified", { userId: "u_1" });

    await tracker.close();

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject([{ payload: { userId: "u_1" } }]);
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

    tracker.track("signup", { plan: "free", userId: "u_1" });

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

    tracker.track("signup", { plan: "free", userId: "u_1" });

    await waitFor(() => errors.length === 1);
    expect(errors[0]).toBeInstanceOf(TrackerClosedError);
  });

  it("rejects tracking while close is in progress", async () => {
    const errors: unknown[] = [];
    const delivered: TrackedEvent<typeof events>[] = [];
    const tracker = createTracker({
      events,
      flushInterval: 0,
      onError: (error) => errors.push(error),
      sink: async (batch) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        delivered.push(...batch);
      },
    });

    tracker.track("signup", { plan: "free", userId: "u_1" });

    const closed = tracker.close();

    tracker.track("signup", { plan: "pro", userId: "u_2" });
    await expect(
      tracker.trackNow("signup", { plan: "pro", userId: "u_3" })
    ).rejects.toBeInstanceOf(TrackerClosedError);

    await closed;

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(TrackerClosedError);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ payload: { userId: "u_1" } });
  });
});
