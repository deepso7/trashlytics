import { describe, expect, it } from "vitest";
import { createEvent } from "../src/event.js";

describe("Event", () => {
  describe("createEvent", () => {
    it("should create an event with the given name and payload", () => {
      const event = createEvent("test_event", { foo: "bar" }, { id: "123" });

      expect(event.id).toBe("123");
      expect(event.name).toBe("test_event");
      expect(event.payload).toEqual({ foo: "bar" });
      expect(event.metadata).toEqual({});
      expect(typeof event.timestamp).toBe("number");
    });

    it("should include metadata when provided", () => {
      const event = createEvent(
        "test_event",
        { foo: "bar" },
        {
          id: "123",
          metadata: { userId: "user_1", sessionId: "sess_1" },
        }
      );

      expect(event.metadata).toEqual({
        userId: "user_1",
        sessionId: "sess_1",
      });
    });

    it("should use custom timestamp when provided", () => {
      const customTimestamp = 1_234_567_890;
      const event = createEvent(
        "test_event",
        {},
        {
          id: "123",
          timestamp: customTimestamp,
        }
      );

      expect(event.timestamp).toBe(customTimestamp);
    });

    it("should use Date.now() when timestamp not provided", () => {
      const before = Date.now();
      const event = createEvent("test_event", {}, { id: "123" });
      const after = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
