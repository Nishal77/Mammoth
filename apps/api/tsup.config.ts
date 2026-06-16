import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  bundle: true,
  splitting: false,
  clean: true,
  // Bundle all @mammoth/* workspace packages inline — they export TS source,
  // not compiled JS, so they cannot be left as external node_modules.
  noExternal: [/@mammoth\/.*/],
});
