# trashlytics

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
