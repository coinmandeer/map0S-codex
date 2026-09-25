import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import maplibreWorker from "maplibre-gl/dist/maplibre-gl-csp-worker?url";
import { App } from "./App";
import { registerPmTilesProtocol } from "./map/pmtilesProtocol";
import { registerTileCacheProtocol } from "./map/tileCache";
import { getMapStore } from "./store/mapStore";
import { ToastProvider, TooltipProvider } from "./ui/kit";
// Inter covers body and headings alike. The icon font is not imported here: it is declared
// in kit.css against a committed subset, so it is fetched only once something renders a glyph.
import "@fontsource-variable/inter/standard.css";
import "./styles/global.css";
import "./ui/layers/layerActivity.css";
import "maplibre-gl/dist/maplibre-gl.css";

// Before any map is constructed: a style that references a `pmtiles://` URL is resolved as the
// map loads, and an unregistered scheme fails the whole style rather than one source.
registerPmTilesProtocol();
// The shared tile cache, for the same reason and at the same moment: an overlay's tile template
// names this scheme, and a style referencing an unregistered one fails as a whole.
registerTileCacheProtocol();

// Apply stored theme before first paint so headings/body inherit the right color.
{
  const theme = getMapStore().theme;
  document.documentElement.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
  document.documentElement.style.colorScheme = theme;
}

// Clear leftover QuestLayer / Next.js service workers from previous deploys. Once per browser:
// repeating it on every start cost a registration query and a cache sweep each time, and would
// remove a future service worker of this app as soon as it was installed.
const SERVICE_WORKER_CLEANUP_KEY = "mapos:legacy-sw-cleared-v1";
let serviceWorkerCleared = false;
try {
  serviceWorkerCleared = window.localStorage.getItem(SERVICE_WORKER_CLEANUP_KEY) === "1";
} catch {
  /* Without storage the cleanup simply runs again. */
}
if (!serviceWorkerCleared && "serviceWorker" in navigator) {
  void Promise.all([
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((reg) => reg.unregister()))),
    "caches" in window
      ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      : Promise.resolve()
  ])
    .then(() => {
      try {
        window.localStorage.setItem(SERVICE_WORKER_CLEANUP_KEY, "1");
      } catch {
        /* Runs again next time. */
      }
    })
    .catch(() => {});
}

const root = createRoot(document.getElementById("root")!);

function render(children: ReactNode) {
  root.render(
    <StrictMode>
      <TooltipProvider>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
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
  if (import.meta.env.MODE === "performance") {
    void import("./map/performanceHarness").then((module) => {
      module.installPerformanceHarness();
      render(<App />);
    });
  } else render(<App />);
}
