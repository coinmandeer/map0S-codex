import type { Place } from "@mapos/layer-sdk";
import type { InfoPanelProps } from "../registry";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function hasPracticalFacts(place: Place): boolean {
  return Boolean(
    place.address ||
    place.openingHours ||
    place.phone ||
    place.website ||
    place.elevationM !== undefined ||
    place.tags?.length
  );
}

export function PracticalPanel({ place }: InfoPanelProps) {
  return (
    <div className="info-panel" data-testid="panel-practical">
      <dl className="info-facts">
        {place.address && (
          <>
            <dt>Adresa</dt>
            <dd>{place.address}</dd>
          </>
        )}
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
    </div>
  );
}
