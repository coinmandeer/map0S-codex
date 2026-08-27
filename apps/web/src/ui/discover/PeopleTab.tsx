import { useEffect, useState } from "react";
import { countryBbox } from "../../lib/countries";
import { emit } from "../../lib/events";
import { apiGetSafe } from "../../lib/api";
import { getMapStore } from "../../store/mapStore";

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

const KIND_LABEL: Record<string, string> = {
  place: "Místo",
  route: "Trasa",
  task: "Úkol"
};

/** Public pins by other people — and the seam the social layer grows from, which is why it is
 *  its own tab rather than a section at the bottom of another one. */
export function PeopleTab({
  countryCode,
  activeTag
}: {
  countryCode: string;
  activeTag: string | null;
}) {
  const store = getMapStore();
  const [posts, setPosts] = useState<DiscoverPost[]>([]);
  const [loading, setLoading] = useState(false);

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
    void apiGetSafe<{ posts?: DiscoverPost[] }>(`/discover?${params}`)
      .then((data) => setPosts(data?.posts ?? []))
      .finally(() => setLoading(false));
  }, [countryCode, activeTag]);

  const flyTo = (lng: number, lat: number) => {
    emit("fly-to", { lng, lat, zoom: 14 });
    store.setView({ lng, lat, zoom: 14 });
    if (window.innerWidth < 900) store.setSidebarOpen(false);
  };

  return (
    <section className="discover-section">
      <h4>Příspěvky lidí</h4>
      {loading && <p className="meta">Načítám…</p>}
      {!loading && posts.length === 0 && (
        <p className="meta">Zatím žádné veřejné piny pro tuhle zemi.</p>
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
  );
}
