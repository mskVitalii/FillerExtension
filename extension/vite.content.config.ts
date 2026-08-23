import { defineConfig } from "vite";

/**
 * Builds the content script as a single self-contained classic script
 * (no ES module syntax), separately from the crx-plugin build in
 * vite.config.ts. It's no longer declared in manifest.json's
 * `content_scripts` (that would auto-inject it on every page — the
 * "broad host permissions" Chrome Web Store flags for in-depth review).
 * Instead, background/inject-content-script.ts injects this exact file
 * on demand via chrome.scripting.executeScript, gated by an explicit
 * user gesture (activeTab).
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/content/index.ts",
      formats: ["iife"],
      name: "FillerContentScript",
      fileName: () => "content-script.js",
    },
  },
});
