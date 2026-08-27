import { Suspense, lazy, useEffect } from "react";
import { MapCore } from "./map/MapCore";
import { apiGetSafe, apiPost } from "./lib/api";
import type { ServerCapabilities, UserSession } from "./store/mapStore";
import { getMapStore } from "./store/mapStore";
import { emit } from "./lib/events";
import { geolocation, messageFor, type Fix } from "./lib/geolocation";
import { useMapStoreSnapshot } from "./store/useMapStoreSnapshot";
import { ModeBar } from "./ui/ModeBar";
import { BottomNav } from "./ui/BottomNav";
import { PlacesPanel } from "./ui/PlacesPanel";
import { LayerNotices } from "./ui/LayerNotices";
import { SearchHereButton } from "./ui/SearchHereButton";
import { SourceStatus } from "./ui/SourceStatus";

const PinDetail = lazy(() => import("./ui/PinDetail").then((m) => ({ default: m.PinDetail })));
const AuthSheet = lazy(() => import("./ui/AuthSheet").then((m) => ({ default: m.AuthSheet })));
const EditLayerSheet = lazy(() =>
  import("./ui/EditLayerSheet").then((m) => ({ default: m.EditLayerSheet }))
);
const RouteSheet = lazy(() => import("./ui/RouteSheet").then((m) => ({ default: m.RouteSheet })));
const SettingsSheet = lazy(() =>
  import("./ui/SettingsSheet").then((m) => ({ default: m.SettingsSheet }))
);
const WeatherTimeline = lazy(() =>
  import("./ui/WeatherTimeline").then((m) => ({ default: m.WeatherTimeline }))
);
const EventsTimeline = lazy(() =>
  import("./ui/EventsTimeline").then((m) => ({ default: m.EventsTimeline }))
);
const GameHud = lazy(() => import("./ui/GameHud").then((m) => ({ default: m.GameHud })));
const DiscoverPanel = lazy(() =>
  import("./ui/DiscoverPanel").then((m) => ({ default: m.DiscoverPanel }))
);
const GameSimulationBridge = lazy(() =>
  import("./ui/GameSimulationBridge").then((m) => ({ default: m.GameSimulationBridge }))
);

export function App() {
  const store = getMapStore();
  const sheet = useMapStoreSnapshot((s) => s.sheet);
  const toast = useMapStoreSnapshot((s) => s.toast);
  const mode = useMapStoreSnapshot((s) => s.mode);
  const sidebarOpen = useMapStoreSnapshot((s) => s.sidebarOpen);
  const theme = useMapStoreSnapshot((s) => s.theme);
  const themeClass = theme === "dark" ? "theme-dark" : "theme-light";

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("theme-dark", theme === "dark");
    root.classList.toggle("theme-light", theme === "light");
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    void apiGetSafe<{ capabilities: ServerCapabilities }>("/config").then((data) => {
      if (data) store.setCapabilities(data.capabilities);
    });

    // Every visitor gets an identity before they touch anything, so catching a ghost, saving a
    // place or (later) following someone never stops to ask for a login. Existing sessions are
    // returned unchanged, which makes this safe to call on every boot.
    void apiPost<{ user: UserSession }>("/auth/guest")
      .then((data) => store.setSession(data.user))
      .catch(() => {
        /* Offline or API down — the map still works read-only. */
      });
  }, [store]);

  /** Returns the fix so the caller can reuse it — Objevuj needs the same coordinates to
   *  reverse-geocode the country, and used to ask the device a second time to get them. */
  const flyToMe = async (): Promise<Fix | null> => {
    const goTo = (fix: Fix, zoom: number) => {
      emit("fly-to", { lng: fix.lng, lat: fix.lat, zoom });
      store.setView({ lng: fix.lng, lat: fix.lat, zoom });
    };

    try {
      // Move on the last known position first so the click has an immediate effect, then
      // settle onto the fresh one. Without the first step a cold start looks like nothing
      // happened for several seconds.
      const fix = await geolocation.locate((coarse) => goTo(coarse, 13));
      goTo(fix, 14);
      store.showToast("Jsi tady");
      emit("search-here");
      return fix;
    } catch (error) {
      store.showToast(messageFor(error));
      return null;
    }
  };

  return (
    <div className={`app-shell ${themeClass} ${sidebarOpen ? "panel-open" : ""}`}>
      <MapCore />

      <div className="chrome top-chrome">
        <ModeBar onFlyToMe={flyToMe} />
      </div>

      <SearchHereButton />
      <LayerNotices />
      <SourceStatus floating testId="map-source-strip" />
      <BottomNav />
      <PlacesPanel />
      <Suspense fallback={null}>
        <DiscoverPanel />
      </Suspense>

      {mode === "game" && (
        <Suspense fallback={null}>
          <GameSimulationBridge />
        </Suspense>
      )}

      {mode === "weather" && (
        <Suspense fallback={null}>
          <WeatherTimeline />
        </Suspense>
      )}

      {/* Events are a layer rather than a mode, so their timeline follows the layer being on,
          not the mode being selected — you can watch what's on while browsing anything. */}
      <Suspense fallback={null}>
        <EventsTimeline />
      </Suspense>

      {mode === "game" && (
        <Suspense fallback={null}>
          <GameHud />
        </Suspense>
      )}

      <Suspense fallback={null}>
        {sheet === "pin" && <PinDetail />}
        {sheet === "auth" && <AuthSheet />}
        {sheet === "edit" && <EditLayerSheet />}
        {sheet === "route" && <RouteSheet />}
        {sheet === "settings" && <SettingsSheet />}
      </Suspense>

      {toast && (
        <div className="toast" data-testid="toast">
          {toast}
        </div>
      )}
    </div>
  );
}
