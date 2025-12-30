# trashlytics

A lightweight, generic event tracking library built with [Effect](https://effect.website). Send analytics or any type of events to any destination with built-in batching, retry logic, and middleware support.

## Features

- **Generic Events** - Track any payload type with full TypeScript support
- **Multiple Transports** - Fan-out events to multiple destinations concurrently
- **Batching** - Configurable batch size and flush interval
- **Retry Logic** - Exponential backoff with jitter for failed sends
- **Middleware** - Composable event transformations (filter, enrich, transform)
- **Queue Strategies** - Bounded, dropping, or sliding window queues
- **Universal** - Works in browser and Node.js environments

## Installation

```bash
npm install trashlytics effect
# or
pnpm add trashlytics effect
# or
yarn add trashlytics effect
```

## Quick Start

```typescript
import { Tracker, Transports, TransportError } from "trashlytics"
import { Effect, Layer, Duration } from "effect"

// 1. Create a transport
const httpTransport = {
  name: "http",
  send: (events) =>
    Effect.tryPromise({
      try: () =>
        fetch("/api/analytics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(events),
        }),
      catch: (error) =>
        new TransportError({
          transport: "http",
          reason: String(error),
          retryable: true,
        }),
    }).pipe(Effect.asVoid),
}

// 2. Provide transports
const TransportsLive = Layer.succeed(Transports, [httpTransport])

// 3. Create tracker layer
const TrackerLive = Tracker.make({
  batchSize: 10,
  flushInterval: Duration.seconds(5),
}).pipe(Layer.provide(TransportsLive))

// 4. Use it
const program = Effect.gen(function* () {
  const tracker = yield* Tracker

  yield* tracker.track("page_view", { page: "/home" })
  yield* tracker.track("button_click", { buttonId: "signup" })

  // Graceful shutdown (flushes remaining events)
  yield* tracker.shutdown
})

Effect.runPromise(program.pipe(Effect.provide(TrackerLive)))
```

## Configuration

```typescript
import { Tracker } from "trashlytics"
import { Duration } from "effect"

const TrackerLive = Tracker.make({
  // Batching
  batchSize: 10,                          // Events per batch (default: 10)
  flushInterval: Duration.seconds(5),     // Max time before flush (default: 5s)

  // Queue
  queueCapacity: 1000,                    // Max queued events (default: 1000)
  queueStrategy: "dropping",              // "bounded" | "dropping" | "sliding"

  // Retry
  retryAttempts: 3,                       // Max retry attempts (default: 3)
  retrySchedule: Schedule.exponential("1 second"), // Custom retry schedule

  // Shutdown
  shutdownTimeout: Duration.seconds(30),  // Max shutdown wait (default: 30s)

  // ID Generation
  generateId: () => crypto.randomUUID(),  // Custom ID generator

  // Global Metadata
  metadata: {
    appVersion: "1.0.0",
    environment: "production",
  },

  // Error Callback
  onError: (error, events) => {
    console.error(`Failed to send ${events.length} events:`, error.reason)
  },
})
```

## Middleware

Middleware allows you to transform, filter, or enrich events before they're sent.

### Built-in Middleware

```typescript
import { compose, filter, addMetadata, addMetadataFrom, mapName, mapPayload, tap } from "trashlytics"

// Compose multiple middlewares (executed left to right)
const middleware = compose(
  // Filter out internal events
  filter((event) => !event.name.startsWith("_")),

  // Add static metadata
  addMetadata({
    appVersion: "1.0.0",
    platform: "web",
  }),

  // Add dynamic metadata based on event
  addMetadataFrom((event) => ({
    timestamp: new Date().toISOString(),
    eventCategory: event.name.split("_")[0],
  })),

  // Prefix event names
  mapName((name) => `app.${name}`),

  // Transform payload
  mapPayload((payload) => ({
    ...payload,
    enriched: true,
  })),

  // Side effects (logging, etc.)
  tap((event) => console.log("Tracking:", event.name)),
)

// Use with tracker
const TrackerLive = Tracker.make(config, middleware)
```

### Filtering Events

```typescript
import { filter } from "trashlytics"

// Only track in production
const prodOnly = filter(() => process.env.NODE_ENV === "production")

// Skip certain event types
const skipInternal = filter((event) => event.name !== "debug")

// Filter by payload
const onlyErrors = filter((event) => event.payload?.level === "error")
```

## Multiple Transports

Send events to multiple destinations simultaneously:

```typescript
import { Transports, TransportError } from "trashlytics"
import { Effect, Layer } from "effect"

const httpTransport = {
  name: "http",
  send: (events) => Effect.tryPromise({ /* ... */ }),
}

const consoleTransport = {
  name: "console",
  send: (events) =>
    Effect.sync(() => {
      console.log("[Analytics]", events)
    }),
}

const segmentTransport = {
  name: "segment",
  send: (events) =>
    Effect.forEach(events, (event) =>
      Effect.tryPromise({
        try: () => analytics.track(event.name, event.payload),
        catch: (e) => new TransportError({
          transport: "segment",
          reason: String(e),
          retryable: false,
        }),
      })
    ).pipe(Effect.asVoid),
}

// All transports receive events concurrently
const TransportsLive = Layer.succeed(Transports, [
  httpTransport,
  consoleTransport,
  segmentTransport,
])
```

## Custom Transport

Implement the `Transport` interface to create your own transport:

```typescript
import type { Transport } from "trashlytics"
import { TransportError } from "trashlytics"
import { Effect } from "effect"

const myTransport: Transport = {
  name: "my-transport",
  send: (events) =>
    Effect.gen(function* () {
      for (const event of events) {
        yield* Effect.tryPromise({
          try: async () => {
            // Your send logic here
            await myAnalyticsSDK.track(event.name, event.payload)
          },
          catch: (error) =>
            new TransportError({
              transport: "my-transport",
              reason: String(error),
              retryable: true, // Set to false for non-retryable errors
            }),
        })
      }
    }),
}
```

## Queue Strategies

Control behavior when the event queue is full:

| Strategy | Behavior |
|----------|----------|
| `"bounded"` | Back-pressure - blocks until space is available |
| `"dropping"` | Drops new events when queue is full (default) |
| `"sliding"` | Drops oldest events when queue is full |

```typescript
const TrackerLive = Tracker.make({
  queueCapacity: 500,
  queueStrategy: "sliding", // Keep most recent events
})
```

## API Reference

### Tracker

```typescript
interface Tracker {
  // Track an event (fire-and-forget, queued for batching)
  track<T>(name: string, payload: T): Effect<void>

  // Track with additional metadata
  trackWith<T>(name: string, payload: T, metadata: Record<string, unknown>): Effect<void>

  // Flush all queued events immediately
  flush: Effect<void, TransportError>

  // Graceful shutdown (flush + cleanup)
  shutdown: Effect<void, TransportError>
}
```

### Event

```typescript
interface Event<T = unknown> {
  id: string
  name: string
  timestamp: number
  payload: T
  metadata: Record<string, unknown>
}
```

### TransportError

```typescript
class TransportError {
  readonly _tag = "TransportError"
  readonly transport: string  // Transport name
  readonly reason: string     // Error message
  readonly retryable: boolean // Whether to retry
}
```

## Browser Usage

For browser environments, consider using the Beacon API for reliable delivery:

```typescript
const beaconTransport: Transport = {
  name: "beacon",
  send: (events) =>
    Effect.sync(() => {
      const success = navigator.sendBeacon(
        "/api/analytics",
        JSON.stringify(events)
      )
      if (!success) {
        throw new Error("sendBeacon failed")
      }
    }).pipe(
      Effect.catchAll(() =>
        // Fallback to fetch
        Effect.tryPromise({
          try: () => fetch("/api/analytics", {
            method: "POST",
            body: JSON.stringify(events),
            keepalive: true,
          }),
          catch: (e) => new TransportError({
            transport: "beacon",
            reason: String(e),
            retryable: true,
          }),
        })
      ),
      Effect.asVoid
    ),
}
```

### Page Lifecycle Events

Flush events on page visibility change or unload:

```typescript
// Flush when tab becomes hidden
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    Effect.runFork(tracker.flush)
  }
})

// Flush before page unload
window.addEventListener("pagehide", () => {
  Effect.runFork(tracker.flush)
})
```

## License

MIT
