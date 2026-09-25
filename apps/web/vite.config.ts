import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "mapos-release",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "release.json",
          source: JSON.stringify({
            release: process.env.MAPOS_RELEASE ?? "development",
            builtAt: new Date().toISOString()
          })
        });
      }
    }
  ],
  resolve: {
    alias: [
      { find: "@", replacement: "/src" },
      // The worker is loaded from its own file (`setWorkerUrl` in main.tsx), so the default
      // build's inlined copy of it was dead weight in the main bundle.
      { find: /^maplibre-gl$/, replacement: "maplibre-gl/dist/maplibre-gl-csp.js" }
    ]
  },
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than the app: their own chunks stay cached across
        // releases instead of being downloaded again with every app change.
        manualChunks(id) {
          if (id.includes("/node_modules/maplibre-gl/")) return "maplibre";
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (id.includes("/node_modules/@base-ui/") || id.includes("/node_modules/@floating-ui/"))
            return "ui-kit";
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.MAPOS_DEV_API_PORT ?? 4033}`,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
