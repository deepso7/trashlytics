# trashlytics

## 0.6.0

### Minor Changes

- f5cd79e: Harden delivery and validation, and stop tracing every event.
  
  - `track()` no longer creates tracing spans. It wrapped both `makeEvent` and itself in `Effect.fn`, costing ~3.4us per traced call against ~0.25us untraced — far more than the validate-and-enqueue work being described. `trackNow` keeps its span since it wraps real I/O.
  - Timestamps are read from the Effect `Clock` instead of `Date.now()`, so they can be controlled in tests.
  - `EventValidationError.issues` now reports one issue per invalid field with its `path` for Effect schemas, matching what Standard Schema validators already produced. Effect schemas are normalized with `Schema.toStandardSchemaV1` when the event is defined, so `EventDefinition.schema` is always a `StandardSchemaV1` and `EventValidationError.cause` is no longer set for Effect schemas.
  - Abandoned deliveries are now cancelled. `deliveryTimeout` previously abandoned the fiber while the underlying request kept running; `httpSink` now forwards an `AbortSignal` into `fetch`, and sinks on the root entry receive one as a second argument. It is aborted only on interruption, never after a sink completes normally. `signal` can no longer be passed through `HttpSinkOptions`.
  - Deliveries that cannot succeed are no longer retried. `SinkError` takes an optional `retryable` flag and `httpSink` marks only `408`, `429` and `5xx` as retryable, so a rejected payload no longer burns the retry budget and delays the batches behind it. A `SinkError` raised by a sink on the root entry is passed through rather than re-wrapped, so its `retryable` flag and cause survive.
  - `size()` is available on the Promise tracker, matching `size` on the Effect tracker.
  - The `effect` peer range widened from the exact `4.0.0-rc.113` pin to `>=4.0.0-rc.113 <5`, and the package now ships a `LICENSE` and declares `engines.node` `>=20`.

## 0.5.0

### Minor Changes

- 27061ca: Bump all dependencies to latest, including the `effect` peer requirement from `4.0.0-beta.93` to `4.0.0-rc.113`. Consumers must upgrade their `effect` dependency to `4.0.0-rc.113`.

## 0.4.0

### Minor Changes

- 1d00282: Redesign the SDK: scoped Effect core, non-blocking track, Standard Schema support. Breaking changes:

  - Delivery moved to a background fiber; `track()` only validates and enqueues, never waits on the sink
  - `trashlytics/effect`: `make` replaces `createTracker` and returns a scoped Effect; closing the scope stops the worker and flushes remaining events (replaces `shutdown`)
  - Root entry: `close()` replaces `shutdown()`, trackers support `await using` (`Symbol.asyncDispose`), and pending events auto-flush on page hide/unload in browsers (`flushOnHide`)
  - `event()` accepts Effect schemas, `Schema.Struct` fields, any Standard Schema v1 validator (zod/valibot/arktype), or no schema for payload-less events
  - Unified tagged errors: `EventValidationError`, `UnknownEventError`, `TrackerClosedError`, `QueueFullError`, `SinkError` (replaces `SinkDeliveryError`)
  - New options: `context` (meta enrichment), `retry.jitter`, `deliveryTimeout` (bounds each sink call, default 30s), `maxQueueSize` (renamed from `bufferSize`); `retries` renamed to `retry`
  - `httpSink` defaults to `keepalive: true`; new `beaconSink` for browsers

## 0.3.1

### Patch Changes

- 7dc50f2: Switch the package build from Rolldown to tsdown.

## 0.3.0

### Minor Changes

- a569da2: add jsdocs

## 0.2.1

### Patch Changes

- dea55f6: Use Effect queues, schedules, and semaphores for tracker buffering and interval flushing.

## 0.2.0

### Minor Changes

- edc48f8: reworked

## 0.1.4

### Patch Changes

- 7104765: effect to peerdep

## 0.1.3

### Patch Changes

- 2c86433: remove zod dep

## 0.1.2

### Patch Changes

- b3a4afe: rework

## 0.1.1

### Patch Changes

- 615c1f8: Update readme
- 6efec53: bug fixes

## 0.1.0

### Minor Changes

- b065f8e: Add generic type support for full type-safety across the tracking pipeline.

  - `createTracker<E>()` now requires an event map type parameter for type-safe event tracking
  - `Tracker<E>`, `Transport<E>`, `Middleware<E>`, `TrackerConfig<E>` are all generic
  - `Transport` and `Middleware` have optional defaults for reusable implementations
  - Added `EventMap` and `EventUnion<E>` utility types
  - `identity` middleware is now a function `identity<E>()` instead of a constant

## 0.0.6

### Patch Changes

- 8b2aeba: bump node

## 0.0.5

### Patch Changes

- 83911c4: test

## 0.0.4

### Patch Changes

- d5a5fc0: test

## 0.0.3

### Patch Changes

- 9c7d37e: testing

## 0.0.2

### Patch Changes

- 83dd0df: Initial release
