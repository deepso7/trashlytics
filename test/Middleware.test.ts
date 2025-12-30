import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { Event } from "../src/Event.js";
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
} from "../src/Middleware.js";

const makeTestEvent = (overrides?: Partial<Event>): Event => ({
  id: "test-id",
  name: "test_event",
  timestamp: 1_000_000,
  payload: { data: "test" },
  metadata: {},
  ...overrides,
});

const runMiddleware = <T>(
  mw: {
    transform: (e: Event) => Effect.Effect<Option.Option<Event<T>>, never>;
  },
  event: Event
) => Effect.runSync(mw.transform(event));

describe("Middleware", () => {
  describe("identity", () => {
    it("should pass events through unchanged", () => {
      const event = makeTestEvent();
      const result = runMiddleware(identity, event);

      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrThrow(result)).toEqual(event);
    });
  });

  describe("filter", () => {
    it("should pass events that match predicate", () => {
      const mw = filter((e) => e.name === "test_event");
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(Option.isSome(result)).toBe(true);
    });

    it("should drop events that don't match predicate", () => {
      const mw = filter((e) => e.name === "other_event");
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(Option.isNone(result)).toBe(true);
    });
  });

  describe("addMetadata", () => {
    it("should add metadata to events", () => {
      const mw = addMetadata({ userId: "user_1" });
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(Option.isSome(result)).toBe(true);
      const transformed = Option.getOrThrow(result);
      expect(transformed.metadata).toEqual({ userId: "user_1" });
    });

    it("should merge with existing metadata", () => {
      const mw = addMetadata({ newKey: "newValue" });
      const event = makeTestEvent({ metadata: { existing: "value" } });
      const result = runMiddleware(mw, event);

      expect(Option.isSome(result)).toBe(true);
      const transformed = Option.getOrThrow(result);
      expect(transformed.metadata).toEqual({
        existing: "value",
        newKey: "newValue",
      });
    });
  });

  describe("addMetadataFrom", () => {
    it("should add metadata based on event", () => {
      const mw = addMetadataFrom((e) => ({ eventName: e.name }));
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(Option.isSome(result)).toBe(true);
      const transformed = Option.getOrThrow(result);
      expect(transformed.metadata).toEqual({ eventName: "test_event" });
    });
  });

  describe("mapName", () => {
    it("should transform event name", () => {
      const mw = mapName((name) => `prefix.${name}`);
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(Option.isSome(result)).toBe(true);
      const transformed = Option.getOrThrow(result);
      expect(transformed.name).toBe("prefix.test_event");
    });
  });

  describe("mapPayload", () => {
    it("should transform payload", () => {
      const mw = mapPayload((p: { data: string }) => ({ ...p, extra: true }));
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(Option.isSome(result)).toBe(true);
      const transformed = Option.getOrThrow(result);
      expect(transformed.payload).toEqual({ data: "test", extra: true });
    });
  });

  describe("map", () => {
    it("should transform entire event", () => {
      const mw = map((e) => ({ ...e, name: "transformed" }));
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(Option.isSome(result)).toBe(true);
      const transformed = Option.getOrThrow(result);
      expect(transformed.name).toBe("transformed");
    });
  });

  describe("tap", () => {
    it("should call function without modifying event", () => {
      let called = false;
      const mw = tap(() => {
        called = true;
      });
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(called).toBe(true);
      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrThrow(result)).toEqual(event);
    });
  });

  describe("compose", () => {
    it("should compose multiple middlewares in order", () => {
      const mw = compose(
        addMetadata({ first: true }),
        mapName((n) => `prefixed.${n}`),
        addMetadata({ second: true })
      );
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(Option.isSome(result)).toBe(true);
      const transformed = Option.getOrThrow(result);
      expect(transformed.name).toBe("prefixed.test_event");
      expect(transformed.metadata).toEqual({ first: true, second: true });
    });

    it("should short-circuit when filter drops event", () => {
      let afterFilterCalled = false;
      const mw = compose(
        filter((e) => e.name === "other"),
        tap(() => {
          afterFilterCalled = true;
        })
      );
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(Option.isNone(result)).toBe(true);
      expect(afterFilterCalled).toBe(false);
    });

    it("should return identity when no middlewares provided", () => {
      const mw = compose();
      const event = makeTestEvent();
      const result = runMiddleware(mw, event);

      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrThrow(result)).toEqual(event);
    });
  });
});
