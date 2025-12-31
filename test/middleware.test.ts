import { describe, expect, it } from "vitest";
import type { Event } from "../src/event.js";
import {
  addMetadata,
  addMetadataFrom,
  compose,
  filter,
  identity,
  map,
  mapName,
  mapPayload,
  tap,
} from "../src/middleware.js";

// Define test event types
// biome-ignore lint/style/useConsistentTypeDefinitions: type alias needed for EventMap constraint
type TestEvents = {
  test_event: { data: string };
  other_event: { value: number };
};

type TestPayload = TestEvents[keyof TestEvents];

const makeTestEvent = (
  overrides?: Partial<Event<TestPayload>>
): Event<TestPayload> => ({
  id: "test-id",
  name: "test_event",
  timestamp: 1_000_000,
  payload: { data: "test" },
  metadata: {},
  ...overrides,
});

describe("Middleware", () => {
  describe("identity", () => {
    it("should pass events through unchanged", () => {
      const event = makeTestEvent();
      const result = identity<TestEvents>()(event);

      expect(result).toEqual(event);
    });
  });

  describe("filter", () => {
    it("should pass events that match predicate", () => {
      const mw = filter<TestEvents>((e) => e.name === "test_event");
      const event = makeTestEvent();
      const result = mw(event);

      expect(result).toEqual(event);
    });

    it("should drop events that don't match predicate", () => {
      const mw = filter<TestEvents>((e) => e.name === "other_event");
      const event = makeTestEvent();
      const result = mw(event);

      expect(result).toBeNull();
    });
  });

  describe("addMetadata", () => {
    it("should add metadata to events", () => {
      const mw = addMetadata<TestEvents>({ userId: "user_1" });
      const event = makeTestEvent();
      const result = mw(event);

      expect(result).not.toBeNull();
      expect(result?.metadata).toEqual({ userId: "user_1" });
    });

    it("should merge with existing metadata", () => {
      const mw = addMetadata<TestEvents>({ newKey: "newValue" });
      const event = makeTestEvent({ metadata: { existing: "value" } });
      const result = mw(event);

      expect(result).not.toBeNull();
      expect(result?.metadata).toEqual({
        existing: "value",
        newKey: "newValue",
      });
    });
  });

  describe("addMetadataFrom", () => {
    it("should add metadata based on event", () => {
      const mw = addMetadataFrom<TestEvents>((e) => ({ eventName: e.name }));
      const event = makeTestEvent();
      const result = mw(event);

      expect(result).not.toBeNull();
      expect(result?.metadata).toEqual({ eventName: "test_event" });
    });
  });

  describe("mapName", () => {
    it("should transform event name", () => {
      const mw = mapName<TestEvents>((name) => `prefix.${name}`);
      const event = makeTestEvent();
      const result = mw(event);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("prefix.test_event");
    });
  });

  describe("mapPayload", () => {
    it("should transform payload", () => {
      const mw = mapPayload<TestEvents>((p) => {
        if ("data" in p) {
          return { ...p, extra: true } as TestPayload;
        }
        return p;
      });
      const event = makeTestEvent();
      const result = mw(event);

      expect(result).not.toBeNull();
      expect(result?.payload).toEqual({ data: "test", extra: true });
    });
  });

  describe("map", () => {
    it("should transform entire event", () => {
      const mw = map<TestEvents>((e) => ({ ...e, name: "transformed" }));
      const event = makeTestEvent();
      const result = mw(event);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("transformed");
    });
  });

  describe("tap", () => {
    it("should call function without modifying event", () => {
      let called = false;
      const mw = tap<TestEvents>(() => {
        called = true;
      });
      const event = makeTestEvent();
      const result = mw(event);

      expect(called).toBe(true);
      expect(result).toEqual(event);
    });
  });

  describe("compose", () => {
    it("should compose multiple middlewares in order", () => {
      const mw = compose<TestEvents>(
        addMetadata({ first: true }),
        mapName((n) => `prefixed.${n}`),
        addMetadata({ second: true })
      );
      const event = makeTestEvent();
      const result = mw(event);

      expect(result).not.toBeNull();
      expect(result?.name).toBe("prefixed.test_event");
      expect(result?.metadata).toEqual({ first: true, second: true });
    });

    it("should short-circuit when filter drops event", () => {
      let afterFilterCalled = false;
      const mw = compose<TestEvents>(
        filter((e) => e.name === "other"),
        tap(() => {
          afterFilterCalled = true;
        })
      );
      const event = makeTestEvent();
      const result = mw(event);

      expect(result).toBeNull();
      expect(afterFilterCalled).toBe(false);
    });

    it("should return identity when no middlewares provided", () => {
      const mw = compose<TestEvents>();
      const event = makeTestEvent();
      const result = mw(event);

      expect(result).toEqual(event);
    });
  });
});
