# trashlytics

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
