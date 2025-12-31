---
"trashlytics": minor
---

Add generic type support for full type-safety across the tracking pipeline.

- `createTracker<E>()` now requires an event map type parameter for type-safe event tracking
- `Tracker<E>`, `Transport<E>`, `Middleware<E>`, `TrackerConfig<E>` are all generic
- `Transport` and `Middleware` have optional defaults for reusable implementations
- Added `EventMap` and `EventUnion<E>` utility types
- `identity` middleware is now a function `identity<E>()` instead of a constant
