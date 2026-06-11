import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  css: {
    postcss: "./postcss.config.mjs",
  },
  // Pre-bundle the Tauri plugins the app loads via dynamic import(). Without
  // this, the first runtime import of a not-yet-optimized plugin makes Vite
  // re-optimize and hard-reload the page mid-action (e.g. an export click that
  // then silently does nothing). Listing them bundles them at dev startup.
  optimizeDeps: {
    include: [
      "@tauri-apps/api/core",
      "@tauri-apps/api/window",
      "@tauri-apps/plugin-os",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-updater",
      "@tauri-apps/plugin-process",
    ],
  },
  server: {
    proxy: {
      "/api/anki": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        rewrite: () => "/",
        headers: {
          Origin: "http://127.0.0.1:8765",
        },
      },
    },
  },
  preview: {
    proxy: {
      "/api/anki": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        rewrite: () => "/",
        headers: {
          Origin: "http://127.0.0.1:8765",
        },
      },
    },
  },
});
