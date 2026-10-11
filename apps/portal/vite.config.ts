import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The API is served on the same origin under /api in production (kintsugi-app);
// the dev server proxies that prefix to the local API process (ADR-0017), or to KINTSUGI_API_URL.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    proxy: {
      "/api": { target: process.env["KINTSUGI_API_URL"] ?? "http://localhost:3000", changeOrigin: true },
    },
  },
});
