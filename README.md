# trashlytics

A lightweight, type-safe event tracking library with runtime validation, background batching, and retries. Works in Node.js, browsers, and any modern JavaScript runtime.

Effect powers validation and delivery internally. App code uses a plain TypeScript API — no Effect knowledge required. Use `trashlytics/effect` when your app is already Effect-based.

## Quick Start

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
  }),

  pageview: event("page.viewed")
}

const tracker = createTracker({
  events,
  sink: httpSink("/api/events"),
  batchSize: 20,
  flushInterval: 5000,
  retry: { attempts: 3, delay: 250, factor: 2, jitter: true },
  context: () => ({ sessionId: getSessionId() }),
  onError(error, batch) {
    console.warn("event delivery failed", error, batch)
  }
})

tracker.track("signup", { userId: "u_123", plan: "free" })
tracker.track("pageview") // payload-less event

await tracker.close() // flush everything and release resources
```

`track` is fire-and-forget: it validates, stamps, and queues the event, and **never blocks on the network**. Delivery happens on a background fiber — when the batch size is reached, on the flush interval, on `flush()`, and on `close()`.

## Schemas: Effect or Standard Schema

Event payloads can be validated with Effect schemas **or any [Standard Schema v1](https://standardschema.dev) validator** (zod, valibot, arktype, ...):

```ts
import { z } from "zod"

const events = {
  signup: event("user.signup", z.object({
    userId: z.string(),
    plan: z.enum(["free", "pro"])
  }))
}
```

Payload types are inferred from the schema either way.

## Type-Safe Batches

The sink receives a discriminated union based on your event map.

```ts
const tracker = createTracker({
  events,
  sink: async (batch) => {
    for (const item of batch) {
      if (item.key === "signup") {
        item.payload.plan // "free" | "pro"
      }

      if (item.key === "purchase") {
        item.payload.total // number
      }
    }
  }
})
```

Each event includes the local typed key, the external event name, a timestamp, and merged metadata:

```ts
type Event = {
  key: "signup"
  name: "user.signup"
  payload: { userId: string; plan: "free" | "pro" }
  timestamp: number
  meta?: Record<string, unknown>
}
```

`timestamp` is read from the Effect `Clock`, so it can be controlled in tests; pass `{ timestamp }` per event to override it.

`meta` is the tracker-level `context` (static object or lazy function) merged with per-event metadata:

```ts
tracker.track("signup", payload, { meta: { experiment: "b" } })
```

## Sinks

A sink is just a function receiving batches. It can return `void`, a `Promise`, or an Effect.

- `httpSink(url, options?)` — POSTs JSON batches with `fetch`. `keepalive` defaults to `true` so requests survive page unloads.
- `beaconSink(url)` — delivers with `navigator.sendBeacon` (browsers).
- `consoleSink()` — logs batches.
- Any custom function: `sink: async (batch, signal) => { ... }`.

Failed deliveries are retried per the `retry` policy; batches that still fail are reported to `onError` and dropped.

Retries only continue while redelivery could plausibly succeed. `httpSink` retries `429` and `5xx` responses plus transport errors, and gives up immediately on other `4xx` responses — resending a payload the server rejected only delays the batches behind it. Custom sinks can say the same by failing with `new SinkError({ cause, retryable: false })`.

The second argument is an `AbortSignal` that is aborted when a delivery is abandoned, either because `deliveryTimeout` elapsed or because delivery was interrupted. Forward it to cancellable work so abandoned deliveries stop consuming resources:

```ts
sink: async (batch, signal) => {
  await fetch("/api/events", {
    method: "POST",
    body: JSON.stringify(batch),
    signal
  })
}
```

It is never aborted after a sink completes normally, so `signal.aborted` is a truthful answer to "was this delivery abandoned?". Sinks on the Effect entry observe abandonment through interruption instead and take no `signal` argument.

## Immediate Delivery

Use `trackNow` when the caller needs to wait for delivery (it bypasses the queue):

```ts
await tracker.trackNow("purchase", { orderId: "o_123", total: 49 })
```

## Lifecycle

`close()` stops background delivery, flushes all remaining events, and releases resources. Trackers also implement `AsyncDisposable`:

```ts
await using tracker = createTracker({ events, sink })
// tracker.close() runs automatically at scope exit
```

In browsers, the tracker automatically flushes when the page is hidden or unloading (`visibilitychange`/`pagehide`). Disable with `flushOnHide: false`.

`size()` reports how many events are queued, which is useful for observing backpressure before `maxQueueSize` starts rejecting events (`tracker.size` on the Effect entry).

## Errors

All failures are tagged: `EventValidationError`, `UnknownEventError`, `TrackerClosedError`, `QueueFullError`, `SinkError`. `onError` observes every delivery failure (from background flushing, `flush`, and `trackNow`) plus validation failures from fire-and-forget `track`; `trackNow` and `flush` additionally reject with the failure so callers can react.

`EventValidationError.issues` carries one entry per invalid field, with the path to it, whichever validator declared the event:

```ts
tracker.track("signup", { userId: 42, plan: "enterprise" })
// EventValidationError.issues ->
// [
//   { message: "Expected string", path: ["userId"] },
//   { message: 'Expected "free" | "pro"', path: ["plan"] }
// ]
```

## Effect-Native API

```ts
import { Effect, Schema } from "effect"
import * as Tracker from "trashlytics/effect"

const events = {
  signup: Tracker.event("user.signup", {
    userId: Schema.String,
    plan: Schema.Literals(["free", "pro"])
  })
}

const program = Effect.gen(function* () {
  const tracker = yield* Tracker.make({
    events,
    sink: Tracker.httpSink("/api/events"),
    retry: { attempts: 3 }
  })

  yield* tracker.track("signup", { userId: "u_123", plan: "free" })
  yield* tracker.flush
}).pipe(Effect.scoped)
```

`Tracker.make` is scoped: closing the scope interrupts the background delivery fiber and flushes all remaining events. Errors are fully typed in the failure channel (`TrackError` for `track`, the sink's error type for `flush`/`trackNow`).

To share a tracker across your app, wrap it in a Layer:

```ts
import { Context, Layer } from "effect"

class Analytics extends Context.Service<Analytics, Tracker.Tracker<typeof events>>()("Analytics") {}

const AnalyticsLayer = Layer.effect(Analytics, Tracker.make({ events, sink }))
```

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `batchSize` | `20` | Max events per sink call. Reaching it triggers background delivery. |
| `flushInterval` | `5000` | Auto-flush interval in ms. `0` disables interval flushing. |
| `deliveryTimeout` | `30000` | Max ms per sink call before the attempt is failed (and retried per `retry`). Keeps `flush`/`close` bounded even if a sink never settles. `0` disables. |
| `maxQueueSize` | `1000` | Max queued events; beyond it new events are rejected. |
| `retry` | none | Retry count or `{ attempts, delay, factor, jitter }`. |
| `context` | none | Static or lazy metadata merged into every event's `meta`. |
| `onError` | none | Observes validation and delivery failures. |
| `flushOnHide` | `true` | (Root entry only) flush on page hide/unload in browsers. |

## License

MIT
