import { defineConfig } from "rolldown";

export default defineConfig([
  // ESM build
  {
    input: "src/index.ts",
    output: {
      dir: "dist",
      format: "esm",
      entryFileNames: "[name].js",
    },
    external: [
      "effect",
      "effect/Effect",
      "effect/Queue",
      "effect/Fiber",
      "effect/Option",
    ],
  },
  // CJS build
  {
    input: "src/index.ts",
    output: {
      dir: "dist",
      format: "cjs",
      entryFileNames: "[name].cjs",
    },
    external: [
      "effect",
      "effect/Effect",
      "effect/Queue",
      "effect/Fiber",
      "effect/Option",
    ],
  },
]);
