import { defineConfig } from "vite";

/**
 * Builds the LinkedIn collector content script (`src/content/linkedin-collector.ts`) as one
 * self-contained classic script, like vite.content.config.ts does for `content-script.js`. It is
 * not in manifest.json's `content_scripts`: background registers it with
 * `chrome.scripting.registerContentScripts` once the user granted `https://www.linkedin.com/*`
 * from the optional host permissions and switched the collector on
 * (features/linkedin-collector/registration.ts).
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
      entry: "src/content/linkedin-collector.ts",
      formats: ["iife"],
      name: "FillerLinkedInCollector",
      fileName: () => "linkedin-collector.js",
    },
  },
});
