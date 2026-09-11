---
"trashlytics": minor
---

Harden delivery and validation, and stop tracing every event.

- `track()` no longer creates tracing spans. It wrapped both `makeEvent` and itself in `Effect.fn`, costing ~3.4us per traced call against ~0.25us untraced — far more than the validate-and-enqueue work being described. `trackNow` keeps its span since it wraps real I/O.
- Timestamps are read from the Effect `Clock` instead of `Date.now()`, so they can be controlled in tests.
- `EventValidationError.issues` now reports one issue per invalid field with its `path` for Effect schemas, matching what Standard Schema validators already produced. Effect schemas are normalized with `Schema.toStandardSchemaV1` when the event is defined, so `EventDefinition.schema` is always a `StandardSchemaV1` and `EventValidationError.cause` is no longer set for Effect schemas.
- Abandoned deliveries are now cancelled. `deliveryTimeout` previously abandoned the fiber while the underlying request kept running; `httpSink` now forwards an `AbortSignal` into `fetch`, and sinks on the root entry receive one as a second argument. It is aborted only on interruption, never after a sink completes normally. `signal` can no longer be passed through `HttpSinkOptions`.
- Deliveries that cannot succeed are no longer retried. `SinkError` takes an optional `retryable` flag and `httpSink` marks only `429` and `5xx` as retryable, so a rejected payload no longer burns the retry budget and delays the batches behind it.
- `size()` is available on the Promise tracker, matching `size` on the Effect tracker.
- The `effect` peer range widened from the exact `4.0.0-rc.113` pin to `>=4.0.0-rc.113 <5`, and the package now ships a `LICENSE` and declares `engines.node`.
