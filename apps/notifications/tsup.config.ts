import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  bundle: true,
  splitting: false,
  clean: true,
  noExternal: [/@mammoth\/.*/],
});
