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
    alias: {
      "@": "/src"
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
