import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

// The API is served on the same origin under /api in production (kintsugi-app);
// the dev server proxies that prefix to the local API process (ADR-0017), or to KINTSUGI_API_URL.
// KINTSUGI_PORTAL_HOSTS (comma-separated, from the environment or apps/portal/.env.local) lists extra
// host names the dev server answers to, e.g. a hosts-file alias for localhost.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "KINTSUGI_");
  const allowedHosts = (env["KINTSUGI_PORTAL_HOSTS"] ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      allowedHosts,
      proxy: {
        "/api": { target: env["KINTSUGI_API_URL"] ?? "http://localhost:3000", changeOrigin: true },
      },
    },
  };
});
