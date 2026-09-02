import { useEffect } from "react";
import { MapCore } from "./map/MapCore";
import { apiGetSafe } from "./lib/api";
import { APP_SHELL_V2_ENABLED } from "./lib/featureFlags";
import type { ServerCapabilities } from "./store/mapStore";
import { getMapStore } from "./store/mapStore";
import { emit } from "./lib/events";
import { geolocation, messageFor, type Fix } from "./lib/geolocation";
import { useMapStoreSnapshot } from "./store/useMapStoreSnapshot";
import { bootstrapGuestSession } from "./lib/sessionBootstrap";
import { AppShell, LegacyAppShell } from "./ui/shell/AppShell";
import { ModuleErrorBoundary } from "./ui/primitives/ModuleErrorBoundary";
import { useVisualViewportLayout } from "./ui/useVisualViewportLayout";

export function App() {
  const store = getMapStore();
  const sidebarOpen = useMapStoreSnapshot((s) => s.sidebarOpen);
  const theme = useMapStoreSnapshot((s) => s.theme);
  const preferences = useMapStoreSnapshot((s) => s.preferences);
  const experienceId = useMapStoreSnapshot((s) => s.experienceId);
  const themeClass = theme === "dark" ? "theme-dark" : "theme-light";
  useVisualViewportLayout();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("theme-dark", theme === "dark");
    root.classList.toggle("theme-light", theme === "light");
    root.classList.toggle("density-compact", preferences.density === "compact");
    root.style.colorScheme = theme;
    root.lang = preferences.locale;
  }, [preferences.density, preferences.locale, theme]);

  useEffect(() => {
    if (preferences.theme !== "system" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => store.applySystemTheme(query.matches);
    apply();
    query.addEventListener?.("change", apply);
    return () => query.removeEventListener?.("change", apply);
  }, [preferences.theme, store]);

  useEffect(() => {
    document.documentElement.dataset.experience = experienceId;
  }, [experienceId]);

  useEffect(() => {
    void apiGetSafe<{ capabilities: ServerCapabilities }>("/config").then((data) => {
      if (data) store.setCapabilities(data.capabilities);
    });

    // Every visitor gets an identity before they touch anything, so catching a ghost, saving a
    // place or (later) following someone never stops to ask for a login. Existing sessions are
    // returned unchanged, which makes this safe to call on every boot.
    void bootstrapGuestSession()
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
    <div
      className={`app-shell ${themeClass} density-${preferences.density} experience-${experienceId} ${sidebarOpen ? "panel-open" : ""}`}
      data-shell={APP_SHELL_V2_ENABLED ? "v2" : "legacy"}
    >
      {/* The map is intentionally outside the feature-flag branch: opening a surface or rolling
          the chrome back can never construct a second MapLibre instance. */}
      <ModuleErrorBoundary moduleId="map-renderer" title="Mapu se nepodařilo spustit">
        <MapCore />
      </ModuleErrorBoundary>
      <ModuleErrorBoundary moduleId="app-shell" title="Ovládání mapy se nepodařilo načíst">
        {APP_SHELL_V2_ENABLED ? (
          <AppShell onFlyToMe={flyToMe} />
        ) : (
          <LegacyAppShell onFlyToMe={flyToMe} />
        )}
      </ModuleErrorBoundary>
    </div>
  );
}
