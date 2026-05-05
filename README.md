# trashlytics

A lightweight, generic event tracking library with type-safe events, runtime validation, batching, and retries.

Effect powers validation and delivery internally. App code uses a plain TypeScript API.

## Usage

```ts
import { Schema } from "effect"
import { createTracker, event, httpSink } from "trashlytics"

const events = {
  signup: event("user.signup", {
    userId: Schema.String,
    plan: Schema.Literals(["free", "pro"])
  }),

  purchase: event("purchase.completed", {
    orderId: Schema.String,
    total: Schema.Number
  })
}

const tracker = createTracker({
  events,
  sink: httpSink("/api/events"),
  batchSize: 20,
  flushInterval: 5000,
  retries: {
    attempts: 3,
    delay: 250,
    factor: 2
  },
  onError(error, batch) {
    console.warn("event delivery failed", error, batch)
  }
})

tracker.track("signup", {
  userId: "u_123",
  plan: "free"
})

await tracker.flush()
```

## Type-Safe Batches

The sink receives a discriminated union based on your event map.

```ts
const tracker = createTracker({
  events,
  sink: async (batch) => {
    for (const item of batch) {
      if (item.key === "signup") {
        item.payload.plan
        // "free" | "pro"
      }

      if (item.key === "purchase") {
        item.payload.total
        // number
      }
    }
  }
})
```

Each event includes both the local typed key and the external event name.

```ts
type Event = {
  key: "signup"
  name: "user.signup"
  payload: { userId: string; plan: "free" | "pro" }
  timestamp: number
  meta?: Record<string, unknown>
}
```

## Immediate Delivery

Use `trackNow` when the caller needs to wait for delivery.

```ts
await tracker.trackNow("purchase", {
  orderId: "o_123",
  total: 49
})
```

## Custom Sinks

Core delivery is sink-based, so you can send events anywhere.

```ts
const tracker = createTracker({
  events,
  sink: async (batch) => {
    await fetch("/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch)
    })
  }
})
```

## Browser Support

The core uses browser-safe timers and no Node-only APIs. `httpSink` uses `globalThis.fetch`.

For page unloads, use `flush()` on lifecycle events when possible. Browsers may still terminate pending async work during tab close.

## License

MIT
