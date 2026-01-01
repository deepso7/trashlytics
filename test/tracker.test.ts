import { describe, expect, it, vi } from "vitest";
import type { Event, Transport } from "../src/index.js";
import {
  addMetadata,
  compose,
  createTracker,
  filter,
  mapName,
  noopLogger,
  TransportError,
} from "../src/index.js";

// Define test event types
// biome-ignore lint/style/useConsistentTypeDefinitions: type alias needed for EventMap constraint
type TestEvents = {
  page_view: { page: string; referrer?: string };
  button_click: { buttonId: string };
  purchase: { productId: string; amount: number };
};

/**
 * Creates a mock transport that records sent events
 */
const createMockTransport = () => {
  const sentBatches: Event<TestEvents[keyof TestEvents]>[][] = [];
  const transport: Transport<TestEvents> = {
    name: "mock",
    send: vi.fn(async (events) => {
      sentBatches.push([...events] as Event<TestEvents[keyof TestEvents]>[]);
      await Promise.resolve();
    }),
  };
  return { transport, sentBatches };
};

describe("Tracker - Complete Flow", () => {
  describe("basic tracking flow", () => {
    it("should track events and send them via transport on flush", async () => {
      const { transport, sentBatches } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        logger: noopLogger,
      });

      // Track some events
      tracker.track("page_view", { page: "/home" });
      tracker.track("button_click", { buttonId: "signup" });
      tracker.track("purchase", { productId: "prod_123", amount: 99.99 });

      // Manually flush
      await tracker.flush();

      // Verify events were sent
      expect(sentBatches).toHaveLength(1);
      const batch = sentBatches.at(0);
      expect(batch).toHaveLength(3);

      if (!batch) {
        throw new Error("Expected batch to exist");
      }

      // Verify event contents
      expect(batch.at(0)?.name).toBe("page_view");
      expect(batch.at(0)?.payload).toEqual({ page: "/home" });
      expect(batch.at(1)?.name).toBe("button_click");
      expect(batch.at(1)?.payload).toEqual({ buttonId: "signup" });
      expect(batch.at(2)?.name).toBe("purchase");
      expect(batch.at(2)?.payload).toEqual({
        productId: "prod_123",
        amount: 99.99,
      });

      // All events should have id and timestamp
      for (const event of batch) {
        expect(event.id).toBeDefined();
        expect(typeof event.id).toBe("string");
        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe("number");
      }

      await tracker.shutdown();
    });

    it("should handle trackAsync correctly", async () => {
      const { transport, sentBatches } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        logger: noopLogger,
      });

      // trackAsync should work even with a single event
      await tracker.trackAsync("page_view", { page: "/about" });

      await tracker.flush();

      expect(sentBatches).toHaveLength(1);
      expect(sentBatches.at(0)?.at(0)?.name).toBe("page_view");
      expect(sentBatches.at(0)?.at(0)?.payload).toEqual({ page: "/about" });

      await tracker.shutdown();
    });

    it("should include metadata with trackWith", async () => {
      const { transport, sentBatches } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        logger: noopLogger,
      });

      // Track multiple events including trackWith
      tracker.track("page_view", { page: "/home" });
      tracker.trackWith(
        "button_click",
        { buttonId: "cta" },
        { userId: "user_123", sessionId: "sess_abc" }
      );
      tracker.track("purchase", { productId: "test", amount: 10 });

      await tracker.flush();

      expect(sentBatches).toHaveLength(1);
      expect(sentBatches.at(0)?.at(1)?.metadata).toEqual({
        userId: "user_123",
        sessionId: "sess_abc",
      });

      await tracker.shutdown();
    });
  });

  describe("middleware integration", () => {
    it("should apply middleware transformations to events", async () => {
      const { transport, sentBatches } = createMockTransport();

      const middleware = compose<TestEvents>(
        addMetadata({ appVersion: "1.0.0", environment: "test" }),
        mapName((name) => `app.${name}`)
      );

      const tracker = createTracker<TestEvents>(
        {
          transports: [transport],
          batchSize: 10,
          flushIntervalMs: 10_000,
          logger: noopLogger,
        },
        middleware
      );

      tracker.track("page_view", { page: "/home" });
      tracker.track("button_click", { buttonId: "test" });
      tracker.track("purchase", { productId: "p1", amount: 10 });

      await tracker.flush();

      expect(sentBatches).toHaveLength(1);
      const event = sentBatches.at(0)?.at(0);
      expect(event?.name).toBe("app.page_view");
      expect(event?.metadata).toMatchObject({
        appVersion: "1.0.0",
        environment: "test",
      });

      await tracker.shutdown();
    });

    it("should filter out events based on middleware", async () => {
      const { transport, sentBatches } = createMockTransport();

      // Filter out button_click events
      const middleware = compose<TestEvents>(
        filter((e) => e.name !== "button_click")
      );

      const tracker = createTracker<TestEvents>(
        {
          transports: [transport],
          batchSize: 10,
          flushIntervalMs: 10_000,
          logger: noopLogger,
        },
        middleware
      );

      tracker.track("page_view", { page: "/home" });
      tracker.track("button_click", { buttonId: "signup" }); // Should be filtered
      tracker.track("purchase", { productId: "prod_1", amount: 50 });

      await tracker.flush();

      expect(sentBatches).toHaveLength(1);
      const batch = sentBatches.at(0);
      expect(batch).toHaveLength(2);
      expect(batch?.map((e) => e.name)).toEqual(["page_view", "purchase"]);

      await tracker.shutdown();
    });
  });

  describe("global metadata", () => {
    it("should include global metadata on all events", async () => {
      const { transport, sentBatches } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        metadata: {
          appId: "my-app",
          platform: "web",
        },
        logger: noopLogger,
      });

      tracker.track("page_view", { page: "/home" });
      tracker.track("button_click", { buttonId: "cta" });
      tracker.track("purchase", { productId: "test", amount: 10 });

      await tracker.flush();

      expect(sentBatches).toHaveLength(1);
      const batch = sentBatches.at(0);
      if (!batch) {
        throw new Error("Expected batch to exist");
      }

      for (const event of batch) {
        expect(event.metadata).toMatchObject({
          appId: "my-app",
          platform: "web",
        });
      }

      await tracker.shutdown();
    });
  });

  describe("multiple transports", () => {
    it("should send events to all transports", async () => {
      const mock1 = createMockTransport();
      const mock2 = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [mock1.transport, mock2.transport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        logger: noopLogger,
      });

      tracker.track("page_view", { page: "/home" });
      tracker.track("button_click", { buttonId: "test" });
      tracker.track("purchase", { productId: "p1", amount: 10 });

      await tracker.flush();

      // Both transports should receive the events
      expect(mock1.sentBatches).toHaveLength(1);
      expect(mock2.sentBatches).toHaveLength(1);
      expect(mock1.sentBatches.at(0)?.at(0)?.name).toBe("page_view");
      expect(mock2.sentBatches.at(0)?.at(0)?.name).toBe("page_view");

      await tracker.shutdown();
    });
  });

  describe("custom ID generator", () => {
    it("should use custom ID generator for events", async () => {
      const { transport, sentBatches } = createMockTransport();
      let counter = 0;

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        generateId: () => `custom-id-${++counter}`,
        logger: noopLogger,
      });

      tracker.track("page_view", { page: "/home" });
      tracker.track("button_click", { buttonId: "btn" });
      tracker.track("purchase", { productId: "test", amount: 10 });

      await tracker.flush();

      expect(sentBatches.at(0)?.at(0)?.id).toBe("custom-id-1");
      expect(sentBatches.at(0)?.at(1)?.id).toBe("custom-id-2");
      expect(sentBatches.at(0)?.at(2)?.id).toBe("custom-id-3");

      await tracker.shutdown();
    });
  });

  describe("error handling", () => {
    it("should call onError callback when transport fails", async () => {
      const errors: { error: TransportError; events: readonly Event[] }[] = [];

      const failingTransport: Transport<TestEvents> = {
        name: "failing",
        send: () => {
          return Promise.reject(
            new TransportError({
              transport: "failing",
              reason: "Network error",
              retryable: false,
            })
          );
        },
      };

      const tracker = createTracker<TestEvents>({
        transports: [failingTransport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        retryAttempts: 0,
        onError: (error, events) => {
          errors.push({ error, events });
        },
        logger: noopLogger,
      });

      // Track events - should work with synchronous offer now
      tracker.track("page_view", { page: "/home" });

      await tracker.flush();

      expect(errors).toHaveLength(1);
      expect(errors.at(0)?.error.transport).toBe("failing");
      expect(errors.at(0)?.error.message).toBe("Network error");

      await tracker.shutdown();
    });

    it("should handle transport that throws TransportError", async () => {
      // Create a mock transport that tracks calls but fails
      let sendCalled = false;

      const failingTransport: Transport<TestEvents> = {
        name: "failing",
        send: () => {
          sendCalled = true;
          return Promise.reject(
            new TransportError({
              transport: "failing",
              reason: "Network error",
              retryable: false,
            })
          );
        },
      };

      // Also create a working transport to verify events reach transports
      const { transport: workingTransport, sentBatches } =
        createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [failingTransport, workingTransport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        retryAttempts: 0,
        logger: noopLogger,
      });

      // Track multiple events
      tracker.track("page_view", { page: "/home" });
      tracker.track("button_click", { buttonId: "test" });
      tracker.track("purchase", { productId: "p1", amount: 10 });

      // Flush should not throw even if one transport fails
      await tracker.flush();

      // Verify the failing transport was called
      expect(sendCalled).toBe(true);

      // Verify the working transport still received events
      expect(sentBatches).toHaveLength(1);
      expect(sentBatches.at(0)).toHaveLength(3);

      await tracker.shutdown();
    });
  });

  describe("shutdown behavior", () => {
    it("should flush remaining events on shutdown", async () => {
      const { transport, sentBatches } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 100, // Large batch size so events don't auto-flush
        flushIntervalMs: 100_000, // Long interval
        logger: noopLogger,
      });

      // Track events without flushing
      tracker.track("page_view", { page: "/home" });
      tracker.track("button_click", { buttonId: "cta" });

      // Shutdown should flush remaining events
      await tracker.shutdown();

      expect(sentBatches).toHaveLength(1);
      expect(sentBatches.at(0)).toHaveLength(2);
    });

    it("should throw error when tracking after shutdown", async () => {
      const { transport } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        logger: noopLogger,
      });

      await tracker.shutdown();

      expect(() => {
        tracker.track("page_view", { page: "/home" });
      }).toThrow("Tracker has been shut down");
    });

    it("should handle multiple shutdown calls gracefully", async () => {
      const { transport } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        logger: noopLogger,
      });

      // Multiple shutdown calls should not throw
      await tracker.shutdown();
      await tracker.shutdown();
      await tracker.shutdown();
    });
  });

  describe("empty flush", () => {
    it("should handle flush with no events gracefully", async () => {
      const { transport, sentBatches } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        logger: noopLogger,
      });

      // Flush without any events should not throw
      await tracker.flush();

      expect(sentBatches).toHaveLength(0);

      await tracker.shutdown();
    });

    it("should handle flush after already flushed", async () => {
      const { transport, sentBatches } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 10,
        flushIntervalMs: 10_000,
        logger: noopLogger,
      });

      tracker.track("page_view", { page: "/home" });
      tracker.track("button_click", { buttonId: "test" });
      tracker.track("purchase", { productId: "p1", amount: 10 });
      await tracker.flush();

      // Second flush should not resend events
      await tracker.flush();

      expect(sentBatches).toHaveLength(1);

      await tracker.shutdown();
    });
  });

  describe("automatic flushing", () => {
    it("should automatically flush events after flushInterval", async () => {
      const { transport, sentBatches } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 100, // Large batch size - won't trigger batch-based flush
        flushIntervalMs: 50, // Very short interval for testing
        logger: noopLogger,
      });

      // Track some events
      tracker.track("page_view", { page: "/home" });
      tracker.track("button_click", { buttonId: "cta" });

      // Events should NOT be sent immediately
      expect(sentBatches).toHaveLength(0);

      // Wait for auto-flush to trigger (interval + buffer)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Events should now be sent by the background batch loop
      expect(sentBatches.length).toBeGreaterThanOrEqual(1);

      // Verify the events were sent correctly
      const allEvents = sentBatches.flat();
      expect(allEvents).toHaveLength(2);
      expect(allEvents.at(0)?.name).toBe("page_view");
      expect(allEvents.at(1)?.name).toBe("button_click");

      await tracker.shutdown();
    });

    it("should flush multiple batches over time", async () => {
      const { transport, sentBatches } = createMockTransport();

      const tracker = createTracker<TestEvents>({
        transports: [transport],
        batchSize: 100,
        flushIntervalMs: 30, // Short interval
        logger: noopLogger,
      });

      // Track first batch
      tracker.track("page_view", { page: "/page1" });

      // Wait for first auto-flush
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Track second batch
      tracker.track("page_view", { page: "/page2" });

      // Wait for second auto-flush
      await new Promise((resolve) => setTimeout(resolve, 80));

      // Should have multiple batches
      expect(sentBatches.length).toBeGreaterThanOrEqual(2);

      // Verify all events were sent
      const allEvents = sentBatches.flat();
      const pages = allEvents.map((e) => (e.payload as { page: string }).page);
      expect(pages).toContain("/page1");
      expect(pages).toContain("/page2");

      await tracker.shutdown();
    });
  });

  describe("end-to-end flow", () => {
    it("should handle complete user journey tracking", async () => {
      const { transport, sentBatches } = createMockTransport();

      // Setup with middleware that adds user context
      let userId: string | null = null;
      const middleware = compose<TestEvents>(
        addMetadata({ appVersion: "2.0.0" }),
        (event) => ({
          ...event,
          metadata: {
            ...event.metadata,
            ...(userId ? { userId } : {}),
          },
        })
      );

      const tracker = createTracker<TestEvents>(
        {
          transports: [transport],
          batchSize: 10,
          flushIntervalMs: 10_000,
          metadata: { platform: "web" },
          logger: noopLogger,
        },
        middleware
      );

      // User lands on page (anonymous)
      tracker.track("page_view", { page: "/home", referrer: "google.com" });

      // User signs in
      userId = "user_456";
      tracker.track("page_view", { page: "/dashboard" });

      // User makes a purchase
      tracker.track("purchase", { productId: "prod_abc", amount: 149.99 });

      // User clicks around
      tracker.track("button_click", { buttonId: "logout" });

      await tracker.flush();

      // Verify complete journey
      expect(sentBatches).toHaveLength(1);
      const events = sentBatches.at(0);
      if (!events) {
        throw new Error("Expected events to exist");
      }

      expect(events).toHaveLength(4);

      // First event (anonymous)
      const firstEvent = events.at(0);
      expect(firstEvent?.name).toBe("page_view");
      expect(firstEvent?.payload).toEqual({
        page: "/home",
        referrer: "google.com",
      });
      expect(firstEvent?.metadata).toMatchObject({
        appVersion: "2.0.0",
        platform: "web",
      });
      expect(firstEvent?.metadata.userId).toBeUndefined();

      // Subsequent events (authenticated)
      expect(events.at(1)?.metadata.userId).toBe("user_456");
      expect(events.at(2)?.metadata.userId).toBe("user_456");
      expect(events.at(3)?.metadata.userId).toBe("user_456");

      // Verify purchase event
      const purchaseEvent = events.at(2);
      expect(purchaseEvent?.name).toBe("purchase");
      expect(purchaseEvent?.payload).toEqual({
        productId: "prod_abc",
        amount: 149.99,
      });

      await tracker.shutdown();
    });

    it("should handle complete e2e flow with auto-flush, middleware, multiple transports, and error handling", async () => {
      // Setup multiple transports
      const primaryTransport = createMockTransport();
      const backupTransport = createMockTransport();
      const errorLog: TransportError[] = [];

      // Setup middleware
      let sessionId = "sess_initial";
      const middleware = compose<TestEvents>(
        // Add app metadata
        addMetadata({ appVersion: "3.0.0", environment: "production" }),
        // Add dynamic session ID
        (event) => ({
          ...event,
          metadata: { ...event.metadata, sessionId },
        }),
        // Filter out internal events (events starting with underscore would be filtered)
        filter((e) => !e.name.startsWith("_"))
      );

      // Create tracker with all features
      const tracker = createTracker<TestEvents>(
        {
          transports: [primaryTransport.transport, backupTransport.transport],
          batchSize: 5, // Small batch for testing
          flushIntervalMs: 50, // Short interval for auto-flush
          metadata: { platform: "web", region: "us-east-1" },
          retryAttempts: 1,
          onError: (error) => errorLog.push(error),
          logger: noopLogger,
        },
        middleware
      );

      // Phase 1: Initial page load
      tracker.track("page_view", { page: "/landing" });
      tracker.track("button_click", { buttonId: "hero-cta" });

      // Phase 2: User navigates (new session)
      sessionId = "sess_authenticated";
      tracker.track("page_view", { page: "/dashboard" });
      tracker.track("purchase", { productId: "premium", amount: 99.99 });
      tracker.track("button_click", { buttonId: "download" });

      // Wait for auto-flush to send the batch (5 events = 1 full batch)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify events were sent to both transports
      expect(primaryTransport.sentBatches.length).toBeGreaterThanOrEqual(1);
      expect(backupTransport.sentBatches.length).toBeGreaterThanOrEqual(1);

      // Phase 3: More activity after auto-flush
      tracker.track("page_view", { page: "/settings" });
      tracker.track("button_click", { buttonId: "save" });

      // Manual flush to get remaining events
      await tracker.flush();

      // Collect all events from primary transport
      const allEvents = primaryTransport.sentBatches.flat();

      // Verify total event count
      expect(allEvents).toHaveLength(7);

      // Verify all events have required fields
      for (const event of allEvents) {
        expect(event.id).toBeDefined();
        expect(event.timestamp).toBeDefined();
        expect(event.name).toBeDefined();
        expect(event.payload).toBeDefined();

        // Verify middleware was applied - all events should have app metadata
        expect(event.metadata).toMatchObject({
          appVersion: "3.0.0",
          environment: "production",
          platform: "web",
          region: "us-east-1",
        });

        // All events should have a session ID
        expect(event.metadata.sessionId).toBeDefined();
      }

      // Verify session ID changed mid-stream
      const sessionIds = allEvents.map((e) => e.metadata.sessionId);
      expect(sessionIds.filter((s) => s === "sess_initial")).toHaveLength(2);
      expect(sessionIds.filter((s) => s === "sess_authenticated")).toHaveLength(
        5
      );

      // Verify both transports received the same events
      expect(backupTransport.sentBatches.flat()).toHaveLength(7);

      // Verify no errors occurred
      expect(errorLog).toHaveLength(0);

      // Verify event order is preserved
      const eventNames = allEvents.map((e) => e.name);
      expect(eventNames).toEqual([
        "page_view",
        "button_click",
        "page_view",
        "purchase",
        "button_click",
        "page_view",
        "button_click",
      ]);

      // Graceful shutdown
      await tracker.shutdown();

      // Verify tracking after shutdown throws
      expect(() => tracker.track("page_view", { page: "/error" })).toThrow(
        "Tracker has been shut down"
      );
    });
  });
});
