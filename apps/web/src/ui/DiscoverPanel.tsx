import { useEffect, useState } from "react";
import { countryBbox, getCountryNameCs } from "../lib/countries";
import { getExploreHeroCopy } from "../lib/explore-hero-i18n";
import { getMapStore } from "../store/mapStore";
import { emit, on } from "../lib/events";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { API_BASE } from "../lib/api";
import { PanelShell } from "./PanelShell";

interface DiscoverPost {
  id: string;
  name: string;
  description: string | null;
  lng: number;
  lat: number;
  tags: string[] | null;
  kind: string;
  authorName: string | null;
  layerName: string;
  layerColor: string;
}

interface DiscoverPlace {
  id: string;
  name: string | null;
  category: string;
  lng: number;
  lat: number;
}

interface WikiPoi {
  pageId: number;
  title: string;
  lng: number;
  lat: number;
}

interface RegionCard {
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

const KIND_LABEL: Record<string, string> = {
  place: "Místo",
  route: "Trasa",
  task: "Úkol"
};

function fitRegion(bbox: [number, number, number, number]) {
  emit("fit-bounds", { bbox });
}

export function DiscoverPanel() {
  const store = getMapStore();
  const open = useMapStoreSnapshot((s) => s.sidebarOpen);
  const mode = useMapStoreSnapshot((s) => s.mode);
  const countryCode = useMapStoreSnapshot((s) => s.countryCode);
  const activeTag = useMapStoreSnapshot((s) => s.activeTag);
  const [posts, setPosts] = useState<DiscoverPost[]>([]);
  const [places, setPlaces] = useState<DiscoverPlace[]>([]);
  const [wiki, setWiki] = useState<WikiPoi[]>([]);
  const [loading, setLoading] = useState(false);
  const [regions, setRegions] = useState<RegionCard[]>([]);
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: "CZ", name: "Česko" }]);
  const [summary, setSummary] = useState<string>("");

  const hero = getExploreHeroCopy(countryCode);
  const isCz = countryCode === "CZ";
  const currentRegionId = crumbs[crumbs.length - 1]?.id ?? "CZ";

  useEffect(() => {
    if (!open || mode !== "discover") return;
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
    fetch(`${API_BASE}/discover?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setPosts(data?.posts ?? []);
        setPlaces(data?.places ?? []);
        setWiki(data?.wikipedia ?? []);
      })
      .catch(() => {
        setPosts([]);
        setPlaces([]);
        setWiki([]);
      })
      .finally(() => setLoading(false));
  }, [open, mode, countryCode, activeTag]);

  useEffect(() => {
    if (mode !== "discover") return;
    if (!isCz) {
      setRegions([]);
      emit("discover-geojson", { geojson: { type: "FeatureCollection", features: [] } });
      return;
    }
    const parent = currentRegionId === "CZ" ? undefined : currentRegionId;
    const qs = new URLSearchParams({ country: "CZ" });
    if (parent && crumbs.length === 2) qs.set("parent", parent);
    fetch(`${API_BASE}/discover/regions?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { regions?: RegionCard[]; geojson?: GeoJSON.FeatureCollection } | null) => {
        setRegions(data?.regions ?? []);
        emit("discover-geojson", {
          geojson: data?.geojson ?? { type: "FeatureCollection", features: [] }
        });
      })
      .catch(() => setRegions([]));
  }, [mode, isCz, currentRegionId, crumbs.length]);

  useEffect(() => {
    if (!open || mode !== "discover" || !isCz) {
      setSummary("");
      return;
    }
    fetch(`${API_BASE}/discover/summary?region=${encodeURIComponent(currentRegionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { text?: string } | null) => setSummary(data?.text ?? ""))
      .catch(() => setSummary(""));
  }, [open, mode, isCz, currentRegionId]);

  useEffect(() => {
    if (countryCode === "CZ") setCrumbs([{ id: "CZ", name: "Česko" }]);
  }, [countryCode]);

  useEffect(() => {
    return on("discover-click", (props) => {
      const id = typeof props?.id === "string" ? props.id : null;
      if (!id) return;
      const region = regions.find((r) => r.id === id);
      if (region) openRegion(region);
    });
  }, [regions]);

  if (!open || mode !== "discover") return null;

  const flyTo = (lng: number, lat: number) => {
    emit("fly-to", { lng, lat, zoom: 14 });
    store.setView({ lng, lat, zoom: 14 });
    if (window.innerWidth < 900) store.setSidebarOpen(false);
  };

  const openRegion = (region: RegionCard) => {
    fitRegion(region.bbox);
    if (region.level === "kraj") {
      setCrumbs([
        { id: "CZ", name: "Česko" },
        { id: region.id, name: region.name }
      ]);
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

  return (
    <PanelShell title="Objevuj" testId="discover-panel" className="discover-panel">
      <>
        <div className="discover-hero">
          <h3>{hero.title}</h3>
          <p className="meta">{hero.subtitle}</p>
          <p className="meta">{getCountryNameCs(countryCode)}</p>
        </div>

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
                      if (c.id === "CZ") fitRegion([12.09, 48.55, 18.86, 51.06]);
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

        {loading && <p className="meta">Načítám…</p>}

        <section className="discover-section">
          <h4>Nejzajímavější místa</h4>
          {places.length === 0 && wiki.length === 0 && !loading && (
            <p className="meta">Zatím nic v databázi — přibliž mapu nebo zvol jinou zemi.</p>
          )}
          <div className="discover-cards">
            {[
              ...places.slice(0, 8),
              ...wiki.slice(0, 6).map((w) => ({
                id: `wiki-${w.pageId}`,
                name: w.title,
                category: "wikipedia",
                lng: w.lng,
                lat: w.lat
              }))
            ].map((p) => (
              <button key={p.id} className="discover-card" onClick={() => flyTo(p.lng, p.lat)}>
                <strong>{p.name}</strong>
                <span className="discover-card-kind">{p.category}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="discover-section">
          <h4>Příspěvky lidí</h4>
          {posts.length === 0 && !loading && (
            <p className="meta">Zatím žádné veřejné piny pro tuto zemi.</p>
          )}
          <div className="discover-cards">
            {posts.map((p) => (
              <button key={p.id} className="discover-card" onClick={() => flyTo(p.lng, p.lat)}>
                <strong>{p.name}</strong>
                <span className="discover-card-kind">
                  {KIND_LABEL[p.kind] ?? p.kind}
                  {p.authorName ? ` · ${p.authorName}` : ""}
                </span>
                {p.tags && p.tags.length > 0 && (
                  <div className="tag-row">
                    {p.tags.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        className="tag-chip"
                        onClick={(e) => {
                          e.stopPropagation();
                          store.setActiveTag(t);
                        }}
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>
      </>
    </PanelShell>
  );
}
