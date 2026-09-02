import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import maplibreWorker from "maplibre-gl/dist/maplibre-gl-csp-worker?url";
import { App } from "./App";
import { getMapStore } from "./store/mapStore";
import { ToastProvider, TooltipProvider } from "./ui/kit";
// Inter covers body and headings alike. The icon font is not imported here: it is declared
// in kit.css against a committed subset, so it is fetched only once something renders a glyph.
import "@fontsource-variable/inter/standard.css";
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 }
  }
});

const root = createRoot(document.getElementById("root")!);

function render(children: ReactNode) {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>
  );
}

// `?kit=1` renders the component gallery instead of the app, so a token change can be
// reviewed in one screenshot per theme. The import is dynamic and dev-gated, which keeps the
// gallery and its fixture CSS out of the production bundle entirely.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("kit")) {
  void Promise.all([
    import("./ui/kit/__fixtures__/KitGallery"),
    import("./ui/kit/__fixtures__/gallery.css")
  ]).then(([module]) => render(<module.KitGallery />));
} else {
  // Required for Vite production builds — without this the map canvas stays blank.
  maplibregl.setWorkerUrl(maplibreWorker);
  render(<App />);
}
