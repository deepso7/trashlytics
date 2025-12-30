# Trashlytics

A generic, type-safe, and resilient analytics library built with [Effect](https://effect.website).

## Features

- **Zero-Effect Surface**: Use classes and promises without needing to know or import Effect.
- **Type-Safe**: Define your event schemas using standard TypeScript types.
- **Pluggable Destinations**: Easily add multiple destinations (Console, HTTP, etc.).
- **Resilient**: Leveraging Effect internally for error handling and concurrency.
- **Environment Agnostic**: Works in Browser, Node.js, Bun, and Deno.

## Installation

```bash
pnpm add trashlytics
```

## Usage

### 1. Basic Setup

```typescript
import { Trashlytics, consoleDestination } from "trashlytics";

// 1. Create the Trashlytics instance with desired destinations
const analytics = new Trashlytics({
  destinations: [consoleDestination]
});

// 2. Track events (returns a Promise)
await analytics.track({ 
  name: "button_clicked",
  properties: { button_id: "signup" }
});
```

### 2. HTTP Destination

The HTTP destination uses the native `fetch` API by default.

```typescript
import { Trashlytics, makeHttp } from "trashlytics";

const analytics = new Trashlytics({
  destinations: [
    makeHttp({ 
      url: "https://your-analytics-api.com/v1/track",
      headers: { "Authorization": "Bearer your-token" }
    })
  ]
});

await analytics.track({ name: "page_view", properties: { path: "/" } });
```

### 3. Identifying Users

```typescript
await analytics.identify({
  userId: "user_123",
  traits: { email: "user@example.com", plan: "pro" }
});
```

### 4. Advanced Usage (Effect Integration)

If you are already using Effect, you can provide a custom Layer instead.

```typescript
import { Trashlytics, layer } from "trashlytics";
import { Layer } from "effect";

const customLayer = layer.pipe(...);
const analytics = new Trashlytics({ layer: customLayer });
```

## Architecture

- **`Trashlytics`**: The main class that wraps the Effect runtime.
- **`AnalyticsDestination`**: A simple interface for adding new targets using standard Promises.
- **`Internal`**: Uses Effect internally for its powerful concurrency and error recovery features.

## License

ISC
