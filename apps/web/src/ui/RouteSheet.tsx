import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { getMapStore } from "../store/mapStore";
import { saveUserPlace } from "./saveUserContent";
import { formatDistance } from "../lib/units";

function formatDuration(s: number): string {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

export function RouteSheet() {
  const store = getMapStore();
  const route = useMapStoreSnapshot((s) => s.routePreview);
  const units = useMapStoreSnapshot((s) => s.preferences.units);
  if (!route) return null;

  const profileLabel =
    route.profile === "foot"
      ? "Pěšky"
      : route.profile === "bike"
        ? "Kolo"
        : route.profile === "moto"
          ? "Motorka"
          : route.profile === "camper"
            ? "Karavan"
            : route.profile === "truck"
              ? "Nákladní"
              : "Auto";
  const desktop = typeof window !== "undefined" && window.innerWidth >= 900;
  const dest = route.coordinates[route.coordinates.length - 1];

  const saveRoute = async () => {
    if (!dest) return;
    const result = await saveUserPlace({
      name: `Trasa ${profileLabel} · ${formatDistance(route.distanceM, units)}`,
      lng: dest[0],
      lat: dest[1],
      kind: "route",
      description: `${profileLabel}, ${formatDistance(route.distanceM, units)}`,
      properties: {
        profile: route.profile,
        distanceM: route.distanceM,
        durationS: route.durationS,
        coordinates: route.coordinates
      }
    });
    if (result === "auth") {
      store.openSheet("auth");
      store.showToast("Přihlas se pro uložení trasy");
      return;
    }
    store.showToast(result === "ok" ? "Trasa uložena do mých tras" : "Uložení se nepovedlo");
  };

  return (
    <>
      <div className="overlay" onClick={() => store.setRoutePreview(null)} />
      <div className={`panel ${desktop ? "dialog" : "sheet"}`} data-testid="route-sheet">
        {!desktop && <div className="panel-handle" />}
        <div className="panel-header">
          <h2>Trasa — {profileLabel}</h2>
          <button className="btn btn-ghost" onClick={() => store.setRoutePreview(null)}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          <p style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 8 }}>
            {formatDistance(route.distanceM, units)} · {formatDuration(route.durationS)}
          </p>
          <p className="meta">
            Trasa je na mapě. Pro turn-by-turn navigaci otevři Google Maps z detailu místa.
          </p>
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              className="btn btn-accent"
              data-testid="save-route"
              onClick={() => void saveRoute()}
            >
              Uložit do mých tras
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
