/** biome-ignore-all lint/suspicious/noBitwiseOperators: fine */
import { Effect, Layer } from "effect";

const generateFallbackId = (): string => {
  const hex = "0123456789abcdef";
  let id = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      id += "-";
    } else if (i === 14) {
      id += "4";
    } else if (i === 19) {
      id += hex[(Math.random() * 4) | 8];
    } else {
      id += hex[(Math.random() * 16) | 0];
    }
  }
  return id;
};

export class IdGenerator extends Effect.Service<IdGenerator>()("IdGenerator", {
  succeed: {
    generate: Effect.sync(() =>
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : generateFallbackId()
    ),
  },
}) {
  static Test = Layer.succeed(
    IdGenerator,
    new IdGenerator({ generate: Effect.succeed("test-id") })
  );
}
