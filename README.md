# trashlytics

A lightweight, generic event tracking library with built-in batching, retry logic, and middleware support. Uses [Effect](https://effect.website) internally for robust async handling, but exposes a simple vanilla JavaScript API.

## Features

- **Simple API** - Just functions and Promises, no framework knowledge required
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
import { createTracker, TransportError } from "trashlytics"

// 1. Create a tracker with your transport
const tracker = createTracker({
  transports: [{
    name: "http",
    send: async (events) => {
      const response = await fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(events),
      })
      if (!response.ok) {
        throw new TransportError({
          transport: "http",
          reason: `HTTP ${response.status}`,
          retryable: response.status >= 500,
        })
      }
    },
  }],
  batchSize: 10,
  flushIntervalMs: 5000,
})

// 2. Track events (fire-and-forget)
tracker.track("page_view", { page: "/home" })
tracker.track("button_click", { buttonId: "signup" })

// 3. Graceful shutdown when done
await tracker.shutdown()
```

## Configuration

```typescript
import { createTracker } from "trashlytics"

const tracker = createTracker({
  // Required: array of transports
  transports: [httpTransport, consoleTransport],

  // Batching
  batchSize: 10,              // Events per batch (default: 10)
  flushIntervalMs: 5000,      // Max time before flush in ms (default: 5000)

  // Queue
  queueCapacity: 1000,        // Max queued events (default: 1000)
  queueStrategy: "dropping",  // "bounded" | "dropping" | "sliding"

  // Retry
  retryAttempts: 3,           // Max retry attempts (default: 3)
  retryDelayMs: 1000,         // Base delay for backoff in ms (default: 1000)

  // Shutdown
  shutdownTimeoutMs: 30000,   // Max shutdown wait in ms (default: 30000)

  // ID Generation
  generateId: () => crypto.randomUUID(),  // Custom ID generator

  // Global Metadata (added to all events)
  metadata: {
    appVersion: "1.0.0",
    environment: "production",
  },

  // Error Callback (called after all retries exhausted)
  onError: (error, events) => {
    console.error(`Failed to send ${events.length} events:`, error.message)
  },
})
```

## Middleware

Middleware allows you to transform, filter, or enrich events before they're sent. Middleware functions receive an event and return a transformed event (or `null` to filter it out).

### Built-in Middleware

```typescript
import { createTracker, compose, filter, addMetadata, mapName, tap } from "trashlytics"

// Compose multiple middlewares (executed left to right)
const middleware = compose(
  // Filter out internal events
  filter((event) => !event.name.startsWith("_")),

  // Add static metadata
  addMetadata({
    appVersion: "1.0.0",
    platform: "web",
  }),

  // Prefix event names
  mapName((name) => `app.${name}`),

  // Side effects (logging, etc.)
  tap((event) => console.log("Tracking:", event.name)),
)

// Use with tracker
const tracker = createTracker({ transports }, middleware)
```

### Available Middleware Functions

| Function | Description |
|----------|-------------|
| `filter(predicate)` | Filter events based on a predicate |
| `addMetadata(obj)` | Add static metadata to all events |
| `addMetadataFrom(fn)` | Add dynamic metadata based on event |
| `mapName(fn)` | Transform event name |
| `mapPayload(fn)` | Transform event payload |
| `map(fn)` | Transform entire event |
| `tap(fn)` | Side effects without modifying event |
| `compose(...middlewares)` | Compose multiple middlewares |
| `identity` | Pass-through middleware |

### Custom Middleware

```typescript
import type { Middleware } from "trashlytics"

// Middleware is just a function: Event -> Event | null
const redactPasswords: Middleware = (event) => ({
  ...event,
  payload: {
    ...event.payload,
    password: event.payload.password ? "[REDACTED]" : undefined,
  },
})
```

## Multiple Transports

Send events to multiple destinations simultaneously:

```typescript
import { createTracker, TransportError } from "trashlytics"

const httpTransport = {
  name: "http",
  send: async (events) => {
    await fetch("/api/analytics", {
      method: "POST",
      body: JSON.stringify(events),
    })
  },
}

const consoleTransport = {
  name: "console",
  send: async (events) => {
    console.log("[Analytics]", events)
  },
}

// All transports receive events concurrently
const tracker = createTracker({
  transports: [httpTransport, consoleTransport],
})
```

## Custom Transport

Implement the `Transport` interface:

```typescript
import type { Transport } from "trashlytics"
import { TransportError } from "trashlytics"

const myTransport: Transport = {
  name: "my-analytics",
  send: async (events) => {
    try {
      await myAnalyticsSDK.track(events)
    } catch (error) {
      throw new TransportError({
        transport: "my-analytics",
        reason: String(error),
        retryable: true, // Set false for non-retryable errors
      })
    }
  },
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
const tracker = createTracker({
  transports,
  queueCapacity: 500,
  queueStrategy: "sliding", // Keep most recent events
})
```

## API Reference

### Tracker

```typescript
interface Tracker {
  // Track an event (fire-and-forget)
  track<T>(name: string, payload: T): void

  // Track and wait for queue
  trackAsync<T>(name: string, payload: T): Promise<void>

  // Track with additional metadata
  trackWith<T>(name: string, payload: T, metadata: Record<string, unknown>): void

  // Flush all queued events immediately
  flush(): Promise<void>

  // Graceful shutdown (flush + cleanup)
  shutdown(): Promise<void>
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
class TransportError extends Error {
  transport: string   // Transport name
  retryable: boolean  // Whether to retry
}
```

## Browser Tips

### Beacon API Transport

For reliable delivery on page unload:

```typescript
const beaconTransport: Transport = {
  name: "beacon",
  send: async (events) => {
    const success = navigator.sendBeacon("/api/analytics", JSON.stringify(events))
    if (!success) {
      // Fallback to fetch
      await fetch("/api/analytics", {
        method: "POST",
        body: JSON.stringify(events),
        keepalive: true,
      })
    }
  },
}
```

### Page Lifecycle Events

Flush events when the page is hidden or unloaded:

```typescript
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    tracker.flush()
  }
})

window.addEventListener("pagehide", () => {
  tracker.flush()
})
```

## License

MIT
