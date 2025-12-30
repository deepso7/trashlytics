import { DateTime, Schema } from "effect";

/**
 * @since 1.0.0
 * @category models
 */
export const Event = Schema.Struct({
  name: Schema.String,
  properties: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Any })
  ),
  timestamp: Schema.optionalWith(Schema.DateTimeUtc, {
    default: () => DateTime.unsafeMake(Date.now()),
  }),
});

/**
 * @since 1.0.0
 * @category models
 */
export interface Event extends Schema.Schema.Type<typeof Event> {}

/**
 * @since 1.0.0
 * @category models
 */
export const Identify = Schema.Struct({
  userId: Schema.String,
  traits: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Any })
  ),
  timestamp: Schema.optionalWith(Schema.DateTimeUtc, {
    default: () => DateTime.unsafeMake(Date.now()),
  }),
});

/**
 * @since 1.0.0
 * @category models
 */
export interface Identify extends Schema.Schema.Type<typeof Identify> {}
