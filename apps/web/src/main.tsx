import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import maplibreWorker from "maplibre-gl/dist/maplibre-gl-csp-worker?url";
import { App } from "./App";
import { getMapStore } from "./store/mapStore";
// Archivo carries both the body and display roles — the wdth axis (62–125%) is what gives
// headings their Followable-style expanded look without shipping a second family.
import "@fontsource-variable/archivo/standard.css";
import "./styles/global.css";
import "maplibre-gl/dist/maplibre-gl.css";

// Apply stored theme before first paint so headings/body inherit the right color.
{
  const theme = getMapStore().theme;
  document.documentElement.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
  document.documentElement.style.colorScheme = theme;
}

// Clear leftover QuestLayer / Next.js service workers from previous deploys
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) void reg.unregister();
  });
  if ("caches" in window) {
    void caches.keys().then((keys) => {
      for (const key of keys) void caches.delete(key);
    });
  }
}

// Required for Vite production builds — without this the map canvas stays blank
maplibregl.setWorkerUrl(maplibreWorker);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 }
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
