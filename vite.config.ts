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
