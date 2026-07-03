---
"trashlytics": minor
---

Redesign the SDK: scoped Effect core, non-blocking track, Standard Schema support. Breaking changes:

- Delivery moved to a background fiber; `track()` only validates and enqueues, never waits on the sink
- `trashlytics/effect`: `make` replaces `createTracker` and returns a scoped Effect; closing the scope stops the worker and flushes remaining events (replaces `shutdown`)
- Root entry: `close()` replaces `shutdown()`, trackers support `await using` (`Symbol.asyncDispose`), and pending events auto-flush on page hide/unload in browsers (`flushOnHide`)
- `event()` accepts Effect schemas, `Schema.Struct` fields, any Standard Schema v1 validator (zod/valibot/arktype), or no schema for payload-less events
- Unified tagged errors: `EventValidationError`, `UnknownEventError`, `TrackerClosedError`, `QueueFullError`, `SinkError` (replaces `SinkDeliveryError`)
- New options: `context` (meta enrichment), `retry.jitter`, `maxQueueSize` (renamed from `bufferSize`); `retries` renamed to `retry`
- `httpSink` defaults to `keepalive: true`; new `beaconSink` for browsers
