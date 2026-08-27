import { useEffect, useState } from "react";
import { countryBbox } from "../../lib/countries";
import { emit, on } from "../../lib/events";
import { apiGetSafe } from "../../lib/api";
import { getMapStore } from "../../store/mapStore";

export interface RegionCard {
  id: string;
  name: string;
  level: string;
  parent: string | null;
  bbox: [number, number, number, number];
  osmPois: number;
  userPins: number;
}

interface Crumb {
  id: string;
  name: string;
}

interface NotablePlace {
  id: string;
  name: string | null;
  category: string;
  lng: number;
  lat: number;
  score?: number;
}

export function RegionsTab({ countryCode, activeTag }: { countryCode: string; activeTag: string | null }) {
  const store = getMapStore();
  const [regions, setRegions] = useState<RegionCard[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: "CZ", name: "Česko" }]);
  const [summary, setSummary] = useState("");
  const [places, setPlaces] = useState<NotablePlace[]>([]);
  const [loading, setLoading] = useState(false);

  const isCz = countryCode === "CZ";
  const currentRegionId = crumbs[crumbs.length - 1]?.id ?? "CZ";

  useEffect(() => {
    if (countryCode === "CZ") setCrumbs([{ id: "CZ", name: "Česko" }]);
  }, [countryCode]);

  useEffect(() => {
    if (!isCz) {
      setRegions([]);
      emit("discover-geojson", { geojson: { type: "FeatureCollection", features: [] } });
      return;
    }
    const qs = new URLSearchParams({ country: "CZ" });
    if (currentRegionId !== "CZ" && crumbs.length === 2) qs.set("parent", currentRegionId);
    void apiGetSafe<{ regions?: RegionCard[]; geojson?: GeoJSON.FeatureCollection }>(
      `/discover/regions?${qs}`
    ).then((data) => {
      setRegions(data?.regions ?? []);
      emit("discover-geojson", {
        geojson: data?.geojson ?? { type: "FeatureCollection", features: [] }
      });
    });
  }, [isCz, currentRegionId, crumbs.length]);

  useEffect(() => {
    if (!isCz) {
      setSummary("");
      return;
    }
    void apiGetSafe<{ text?: string }>(
      `/discover/summary?region=${encodeURIComponent(currentRegionId)}`
    ).then((data) => setSummary(data?.text ?? ""));
  }, [isCz, currentRegionId]);

  useEffect(() => {
    const bbox = countryCode === "ALL" ? undefined : countryBbox(countryCode);
    const params = new URLSearchParams({ country: countryCode });
    if (activeTag) params.set("tag", activeTag);
    if (bbox) {
      params.set("west", String(bbox[0]));
      params.set("south", String(bbox[1]));
      params.set("east", String(bbox[2]));
      params.set("north", String(bbox[3]));
    }
    setLoading(true);
    void apiGetSafe<{ places?: NotablePlace[] }>(`/discover?${params}`)
      .then((data) => setPlaces(data?.places ?? []))
      .finally(() => setLoading(false));
  }, [countryCode, activeTag]);

  useEffect(() => {
    return on("discover-click", (props) => {
      const id = typeof props?.id === "string" ? props.id : null;
      const region = id ? regions.find((r) => r.id === id) : null;
      if (region) openRegion(region);
    });
  }, [regions]);

  const openRegion = (region: RegionCard) => {
    emit("fit-bounds", { bbox: region.bbox });
    if (region.level === "kraj") {
      setCrumbs([{ id: "CZ", name: "Česko" }, { id: region.id, name: region.name }]);
    } else if (region.level === "okres") {
      const kraj = crumbs.find((c) => c.id !== "CZ") ?? {
        id: region.parent ?? "CZ",
        name: region.parent ?? "Kraj"
      };
      setCrumbs([
        { id: "CZ", name: "Česko" },
        kraj.id === region.id ? { id: region.parent ?? "CZ", name: "Kraj" } : kraj,
        { id: region.id, name: region.name }
      ]);
    }
  };

  const flyTo = (lng: number, lat: number) => {
    emit("fly-to", { lng, lat, zoom: 14 });
    store.setView({ lng, lat, zoom: 14 });
    if (window.innerWidth < 900) store.setSidebarOpen(false);
  };

  return (
    <>
      {isCz && (
        <>
          <nav className="discover-crumb" data-testid="discover-breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && " / "}
                <button
                  type="button"
                  onClick={() => {
                    setCrumbs(crumbs.slice(0, i + 1));
                    if (c.id === "CZ") emit("fit-bounds", { bbox: [12.09, 48.55, 18.86, 51.06] });
                  }}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </nav>
          {summary && (
            <div className="discover-summary" data-testid="discover-summary">
              {summary}
            </div>
          )}
          {crumbs.length < 3 && (
            <section className="discover-section">
              <h4>{crumbs.length === 1 ? "Kraje" : "Okresy"}</h4>
              <div className="discover-cards">
                {regions.map((r) => (
                  <button
                    key={r.id}
                    className="discover-card"
                    data-testid={`region-${r.id}`}
                    onClick={() => openRegion(r)}
                  >
                    <strong>{r.name}</strong>
                    <span className="discover-card-kind">
                      {r.osmPois} míst · {r.userPins} příspěvků
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <section className="discover-section">
        <h4>Nejzajímavější místa</h4>
        {loading && <p className="meta">Načítám…</p>}
        {!loading && places.length === 0 && (
          <p className="meta">Zatím nic v databázi — přibliž mapu nebo zvol jinou zemi.</p>
        )}
        <div className="discover-cards">
          {places.map((p) => (
            <button
              key={p.id}
              className="discover-card"
              data-testid={`notable-${p.id}`}
              onClick={() => flyTo(p.lng, p.lat)}
            >
              <strong>{p.name ?? "Bez názvu"}</strong>
              <span className="discover-card-kind">{p.category}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
