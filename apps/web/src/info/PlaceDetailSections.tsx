import { useEffect, useState, type ReactNode } from "react";
import type { Place } from "@mapos/layer-sdk";
import { loadDiscoverContext, type DiscoverContext } from "../discover/context";
import { st } from "../statistics/labels";
import { activateStatistic, showStatistics, useStatistics } from "../statistics/explorerStore";
import { Button, Skeleton } from "../ui/kit";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { getMapStore } from "../store/mapStore";
import { distanceMeters } from "@mapos/layer-sdk";
import { apiGet } from "../lib/api";

interface AreaPopulation {
  status: "ready" | "pending" | "unavailable";
  totalPopulation: number | null;
  unit: string;
  year: number;
  coverage: string;
  source: { label: string; license: string; resolution: string };
  reason?: string;
}

/**
 * Population of the small square around a place, summed by WorldPop.
 *
 * Deliberately separate from the provider statistics below: those are administrative averages for
 * a named territory ("Údaje za Prahu 1"), this is a grid sum for the coordinates themselves. The
 * two are different quantities and the panel labels each with what it actually measured.
 */
function AreaPopulationCard({ place }: { place: Place }) {
  const [state, setState] = useState<AreaPopulation | null>(null);
  const box = 0.02;
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    void apiGet<AreaPopulation>("/info/population/area", {
      signal: controller.signal,
      query: {
        bbox: [place.lng - box, place.lat - box, place.lng + box, place.lat + box]
          .map((value) => value.toFixed(4))
          .join(",")
      }
    })
      .then((data) => {
        if (!controller.signal.aborted) setState(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState(null);
      });
    return () => controller.abort();
  }, [place.lat, place.lng]);

  if (!state || state.status !== "ready" || state.totalPopulation === null) return null;
  return (
    <div className="local-stat-area" data-testid="area-population">
      <span>{st("Populace v okolí (součet rastru)", "Population around here (grid sum)")}</span>
      <strong>
        {Math.round(state.totalPopulation).toLocaleString()} {st("obyv.", "people")}
      </strong>
      <small>
        {state.source.label} · {state.year} · {state.source.resolution}
      </small>
    </div>
  );
}

export function DetailDisclosure({
  title,
  children,
  initialOpen = false,
  id
}: {
  title: string;
  children: ReactNode;
  initialOpen?: boolean;
  id: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <details
      className="place-detail-disclosure"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      data-testid={`place-section-${id}`}
    >
      <summary>{title}</summary>
      {open && <div className="place-detail-section-body">{children}</div>}
    </details>
  );
}
export function LocalStatistics({ place }: { place: Place }) {
  const [data, setData] = useState<DiscoverContext | null>(null),
    [error, setError] = useState(false),
    [retry, setRetry] = useState(0),
    [tab, setTab] = useState("population");
  const stats = useStatistics();
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    loadDiscoverContext(
      { lat: place.lat, lng: place.lng, zoom: 12, allowModelFallback: false },
      controller.signal
    )
      .then((d) => {
        if (!controller.signal.aborted) setData(d);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [place.id, place.lat, place.lng, retry]);
  if (error)
    return (
      <Button onClick={() => setRetry((x) => x + 1)}>
        {st("Statistiky se nepodařilo načíst. Zkusit znovu", "Could not load statistics. Retry")}
      </Button>
    );
  if (!data) return <Skeleton count={2} />;
  const group = (s: DiscoverContext["statistics"][number]) =>
    /pop|obyvat|density|hustot|birth|age/i.test(s.id + " " + s.label)
      ? "population"
      : /gdp|income|econom|hdp|wage|unemploy/i.test(s.id + " " + s.label)
        ? "economy"
        : /nature|environment|forest|land|přírod/i.test(s.id + " " + s.label)
          ? "nature"
          : "other";
  return (
    <>
      <div className="local-stat-tabs" role="tablist">
        {[
          ["population", "Obyvatelstvo", "Population"],
          ["economy", "Ekonomika", "Economy"],
          ["nature", "Příroda", "Nature"],
          ["other", "Ostatní", "Other"]
        ].map(([id, cs, en]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id!)}>
            {st(cs!, en!)}
          </button>
        ))}
      </div>
      {tab === "population" && <AreaPopulationCard place={place} />}
      <div className="local-stat-grid">
        {data.statistics
          .filter((s) => group(s) === tab)
          .map((s) => (
            <button
              key={s.id}
              onClick={() => {
                const theme = stats.catalog.find((t) => t.id === s.id || t.name === s.label);
                if (theme)
                  void activateStatistic(theme.id, s.year ? String(s.year) : undefined, undefined, {
                    reveal: true
                  });
                else showStatistics(true);
              }}
            >
              <span>{s.label}</span>
              <strong>
                {s.value.toLocaleString()} {s.unit}
              </strong>
              <small>
                {s.scope.regionName} · {s.year ?? "—"}
              </small>
              <small>{s.uncertaintyLabel}</small>
            </button>
          ))}
      </div>
      {!data.statistics.some((s) => group(s) === tab) && (
        <p className="meta">
          {st(
            "Pro tuto oblast zatím nejsou dostupné odpovídající údaje.",
            "Matching statistics are not available for this area yet."
          )}
        </p>
      )}
    </>
  );
}
export function NearbyMapPlaces({ place, events = false }: { place: Place; events?: boolean }) {
  const visible = useMapStoreSnapshot((s) => s.visibleFeatures);
  const rows = Object.entries(visible)
    .flatMap(([layerId, features]) =>
      features.flatMap((feature) => {
        if (
          (events && layerId !== "events") ||
          (!events && layerId === "events") ||
          feature.geometry.type !== "Point"
        )
          return [];
        const [lng, lat] = feature.geometry.coordinates;
        if (lng === undefined || lat === undefined) return [];
        const distance = distanceMeters({ lng, lat }, place);
        return distance < 10000 && String(feature.properties.id) !== place.id
          ? [{ layerId, feature, distance }]
          : [];
      })
    )
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 20);
  return rows.length ? (
    <ul className="detail-nearby">
      {rows.map(({ feature, layerId, distance }) => (
        <li key={`${layerId}:${feature.properties.id}`}>
          <Button variant="text" onClick={() => getMapStore().selectPin({ feature, layerId })}>
            {String(feature.properties.name ?? feature.properties.id)}
          </Button>
          <small>{Math.round(distance)} m</small>
        </li>
      ))}
    </ul>
  ) : (
    <p className="meta">
      {st(
        "V načteném okolí nejsou další výsledky.",
        "No further results in the loaded surroundings."
      )}
    </p>
  );
}
