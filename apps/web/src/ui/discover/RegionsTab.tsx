import { useEffect, useState } from "react";
import { countryBbox, getCountryNameCs } from "../../lib/countries";
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
  signals?: { pageviews?: number; sitelinks?: number; rate?: number };
}

/** Says why a place is in the list, rather than asking the reader to trust the order. */
function notabilityNote(place: NotablePlace): string | null {
  const { pageviews, sitelinks, rate } = place.signals ?? {};
  const parts: string[] = [];
  if (pageviews) parts.push(`${Math.round(pageviews / 1000)} tis. čtení/měsíc`);
  if (sitelinks && sitelinks > 1) parts.push(`${sitelinks} jazyků`);
  if (rate) parts.push(`hodnocení ${rate}/7`);
  return parts.length ? parts.join(" · ") : null;
}

export function RegionsTab({
  countryCode,
  activeTag
}: {
  countryCode: string;
  activeTag: string | null;
}) {
  const store = getMapStore();
  const [regions, setRegions] = useState<RegionCard[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([
    { id: countryCode, name: getCountryNameCs(countryCode) }
  ]);
  const [summary, setSummary] = useState("");
  const [places, setPlaces] = useState<NotablePlace[]>([]);
  const [loading, setLoading] = useState(false);

  const currentRegionId = crumbs[crumbs.length - 1]?.id ?? countryCode;

  useEffect(() => {
    setCrumbs([{ id: countryCode, name: getCountryNameCs(countryCode) }]);
  }, [countryCode]);

  useEffect(() => {
    if (countryCode === "ALL") {
      setRegions([]);
      emit("discover-geojson", { geojson: { type: "FeatureCollection", features: [] } });
      return;
    }
    const qs = new URLSearchParams({ country: countryCode });
    if (currentRegionId !== countryCode) qs.set("parent", currentRegionId);
    void apiGetSafe<{ regions?: RegionCard[]; geojson?: GeoJSON.FeatureCollection }>(
      `/discover/regions?${qs}`
    ).then((data) => {
      setRegions(data?.regions ?? []);
      emit("discover-geojson", {
        geojson: data?.geojson ?? { type: "FeatureCollection", features: [] }
      });
    });
  }, [countryCode, currentRegionId]);

  useEffect(() => {
    if (countryCode === "ALL") {
      setSummary("");
      return;
    }
    void apiGetSafe<{ text?: string }>(
      `/discover/summary?region=${encodeURIComponent(currentRegionId)}`
    ).then((data) => setSummary(data?.text ?? ""));
  }, [countryCode, currentRegionId]);

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
    setCrumbs((current) => [
      ...current.filter((crumb) => crumb.id !== region.id),
      { id: region.id, name: region.name }
    ]);
  };

  const flyTo = (lng: number, lat: number) => {
    emit("fly-to", { lng, lat, zoom: 14 });
    store.setView({ lng, lat, zoom: 14 });
    if (window.innerWidth < 900) store.setSidebarOpen(false);
  };

  return (
    <>
      {countryCode !== "ALL" && (
        <>
          <nav className="discover-crumb" data-testid="discover-breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && " / "}
                <button
                  type="button"
                  onClick={() => {
                    setCrumbs(crumbs.slice(0, i + 1));
                    if (c.id === countryCode)
                      emit("fit-bounds", { bbox: countryBbox(countryCode) });
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
          {regions.length > 0 && (
            <section className="discover-section">
              <h4>{crumbs.length === 1 ? "Regiony" : `Uvnitř ${crumbs.at(-1)?.name}`}</h4>
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
          {regions.length === 0 && crumbs.length > 1 && (
            <p className="meta">
              Další administrativní úroveň zde OSM nemá; pokračuj místy a komunitním obsahem.
            </p>
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
              {notabilityNote(p) && <span className="discover-card-kind">{notabilityNote(p)}</span>}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
