import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Deliberately separate from `vite.config.ts` — that config pulls in
 * `@crxjs/vite-plugin`, which expects to build a real, loadable extension
 * (manifest, background worker, …) and has no reason to run under a test
 * runner. This only needs the same `@` alias plus a DOM environment.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
  },
});
