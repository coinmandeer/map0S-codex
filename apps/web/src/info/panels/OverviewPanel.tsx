import { PLACE_SOURCE_BY_ID, distanceMeters } from "@mapos/layer-sdk";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import type { InfoPanelProps } from "../registry";

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function OverviewPanel({ place }: InfoPanelProps) {
  const store = getMapStore();
  const view = useMapStoreSnapshot((s) => s.view);
  const gps = `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`;

  const copyGps = async () => {
    try {
      await navigator.clipboard.writeText(gps);
      store.showToast("GPS zkopírováno");
    } catch {
      store.showToast(gps);
    }
  };

  // Caveats the source itself declares belong next to the data, not in a settings sheet.
  const caveats = [
    ...new Set(
      place.sources
        .map((s) => PLACE_SOURCE_BY_ID[s.source]?.caveat)
        .filter((c): c is string => Boolean(c))
    )
  ];

  return (
    <div className="info-panel" data-testid="panel-prehled">
      {place.description && <p>{place.description}</p>}

      <dl className="info-facts">
        {place.address && (
          <>
            <dt>Adresa</dt>
            <dd>{place.address}</dd>
          </>
        )}
        <dt>Vzdálenost</dt>
        <dd>{formatDistance(distanceMeters(view, place))}</dd>
        {place.openingHours && (
          <>
            <dt>Otevírací doba</dt>
            <dd data-testid="fact-hours">{place.openingHours}</dd>
          </>
        )}
        {place.phone && (
          <>
            <dt>Telefon</dt>
            <dd>
              <a href={`tel:${place.phone.replace(/\s+/g, "")}`}>{place.phone}</a>
            </dd>
          </>
        )}
        {place.website && (
          <>
            <dt>Web</dt>
            <dd>
              <a href={place.website} target="_blank" rel="noreferrer" data-testid="fact-website">
                {hostOf(place.website)}
              </a>
            </dd>
          </>
        )}
        {place.elevationM !== undefined && (
          <>
            <dt>Nadmořská výška</dt>
            <dd>{Math.round(place.elevationM)} m n. m.</dd>
          </>
        )}
        <dt>GPS</dt>
        <dd className="info-gps">
          <span>{gps}</span>
          <button className="btn small" type="button" data-testid="copy-gps" onClick={copyGps}>
            Kopírovat
          </button>
        </dd>
      </dl>

      {place.tags?.length ? (
        <div className="tag-grid">
          {place.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {/* Which sources vouch for this place. Shown rather than hidden: a place confirmed by
          three independent sources is a different thing from one scraped pin. */}
      <div className="info-provenance" data-testid="provenance">
        <span className="meta">Zdroje</span>
        <div className="tag-grid">
          {place.sources.map((source) => (
            <span
              key={`${source.source}:${source.sourceRef}`}
              className="tag"
              title={PLACE_SOURCE_BY_ID[source.source]?.attribution ?? source.source}
            >
              {PLACE_SOURCE_BY_ID[source.source]?.label ?? source.source}
            </span>
          ))}
        </div>
        {caveats.map((caveat) => (
          <p key={caveat} className="meta">
            {caveat}
          </p>
        ))}
      </div>
    </div>
  );
}
