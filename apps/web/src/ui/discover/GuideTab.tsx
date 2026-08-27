import { useEffect, useState } from "react";
import type { Guide, GuideItem } from "@mapos/layer-sdk";
import { emit } from "../../lib/events";
import { apiGetSafe } from "../../lib/api";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";

/** Half a degree of latitude ≈ 55 km, which is the scale a town guide describes. Anything
 *  wider and the nearest article would be a country rather than a place to spend a day in. */
const GUIDE_SPAN_DEG = 0.25;

export function GuideTab() {
  const store = getMapStore();
  const view = useMapStoreSnapshot((s) => s.view);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");

  // The guide follows the map, but coarsely: rounding the centre means panning within the same
  // town reuses the article instead of refetching it.
  const areaKey = `${view.lng.toFixed(1)},${view.lat.toFixed(1)}`;

  useEffect(() => {
    const [lng, lat] = areaKey.split(",").map(Number) as [number, number];
    const bbox = [
      lng - GUIDE_SPAN_DEG,
      lat - GUIDE_SPAN_DEG,
      lng + GUIDE_SPAN_DEG,
      lat + GUIDE_SPAN_DEG
    ];
    setState("loading");
    void apiGetSafe<Guide>(`/discover/guide?bbox=${bbox.join(",")}&lang=cs`).then((data) => {
      setGuide(data);
      setState(data?.sections.length ? "ready" : "empty");
    });
  }, [areaKey]);

  const flyToItem = (item: GuideItem) => {
    if (item.lng === undefined || item.lat === undefined) return;
    emit("fly-to", { lng: item.lng, lat: item.lat, zoom: 16 });
    store.setView({ lng: item.lng, lat: item.lat, zoom: 16 });
    if (window.innerWidth < 900) store.setSidebarOpen(false);
  };

  if (state === "loading") return <p className="meta">Načítám průvodce…</p>;
  if (state === "empty" || !guide) {
    return (
      <p className="meta" data-testid="guide-empty">
        Pro tuhle oblast zatím průvodce není. Zkus přiblížit na město.
      </p>
    );
  }

  return (
    <div data-testid="discover-guide">
      <div className="discover-hero">
        <h3>{guide.area}</h3>
        <p className="meta">
          {guide.attribution}
          {guide.url && (
            <>
              {" · "}
              <a href={guide.url} target="_blank" rel="noreferrer noopener">
                celý článek
              </a>
            </>
          )}
        </p>
      </div>

      {guide.sections.map((section) => (
        <section key={section.id} className="discover-section">
          <h4>{section.title}</h4>
          {section.intro && <p className="meta">{section.intro}</p>}
          <div className="discover-cards">
            {section.items.map((item) => {
              const locatable = item.lng !== undefined && item.lat !== undefined;
              return (
                <button
                  key={item.sourceRef}
                  className="discover-card"
                  disabled={!locatable}
                  title={locatable ? "Zobrazit na mapě" : "Bez souřadnic"}
                  onClick={() => flyToItem(item)}
                >
                  <strong>{item.name}</strong>
                  {item.description && (
                    <span className="discover-card-kind">{item.description}</span>
                  )}
                  {(item.hours || item.price) && (
                    <span className="discover-card-kind">
                      {[item.hours, item.price].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
