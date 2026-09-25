import { PLACE_SOURCE_BY_ID, distanceMeters } from "@mapos/layer-sdk";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Chip, IconButton } from "../../ui/kit";
import type { InfoPanelProps } from "../registry";

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
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
        <dt>Vzdálenost</dt>
        <dd>{formatDistance(distanceMeters(view, place))}</dd>
        <dt>GPS</dt>
        <dd className="info-gps">
          <span>{gps}</span>
          <IconButton
            icon="content_copy"
            label="Kopírovat GPS"
            size="sm"
            testId="copy-gps"
            onClick={() => void copyGps()}
          />
        </dd>
        {place.elevationM !== undefined && (
          <>
            <dt>Nadm. výška</dt>
            <dd>{Math.round(place.elevationM)} m n. m.</dd>
          </>
        )}
      </dl>
      {/* Which sources vouch for this place. Shown rather than hidden: a place confirmed by
          three independent sources is a different thing from one scraped pin. */}
      <div className="info-provenance" data-testid="provenance">
        <span className="meta">Zdroje</span>
        <div className="tag-grid">
          {place.sources.map((source) => (
            <Chip
              key={`${source.source}:${source.sourceRef}`}
              label={PLACE_SOURCE_BY_ID[source.source]?.label ?? source.source}
            />
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
