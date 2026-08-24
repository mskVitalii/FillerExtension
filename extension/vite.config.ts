import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

// The Chrome Web Store item's OAuth client is registered against its published extension
// ID, which never matches a locally "Load unpacked" build's ID — so Connect Google can only
// work locally against a second, dev-only OAuth client. VITE_DEV_GOOGLE_CLIENT_ID (set in a
// gitignored extension/.env.local, never committed) swaps it in for local builds only; the
// production build (used for the CWS package) is untouched whenever that file is absent.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const resolvedManifest = env.VITE_DEV_GOOGLE_CLIENT_ID
    ? { ...manifest, oauth2: { ...manifest.oauth2, client_id: env.VITE_DEV_GOOGLE_CLIENT_ID } }
    : manifest;

  return {
    plugins: [react(), crx({ manifest: resolvedManifest as unknown as chrome.runtime.ManifestV3 })],
    resolve: {
      alias: {
        "@": "/src",
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          sidepanel: "src/sidepanel/index.html",
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
  };
});
