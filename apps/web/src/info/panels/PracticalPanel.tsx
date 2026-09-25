import type { Place } from "@mapos/layer-sdk";
import { IconButton } from "../../ui/kit";
import { getMapStore } from "../../store/mapStore";
import { safeExternalUrl } from "../detailModel";
import { t } from "../../i18n";
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
  const gps = `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`;
  const copy = (
    <IconButton
      icon="content_copy"
      size="sm"
      label={t("polish.gps")}
      testId="copy-gps"
      onClick={() => {
        void navigator.clipboard
          .writeText(gps)
          .then(() => getMapStore().showToast(t("polish.gpsCopied")))
          .catch(() => getMapStore().showToast(gps));
      }}
    />
  );
  const website = safeExternalUrl(place.website);
  return (
    <div className="info-panel" data-testid="panel-practical">
      <dl className="info-facts">
        {place.address && (
          <>
            <dt>{t("place.address")}</dt>
            <dd>{place.address}</dd>
          </>
        )}
        {place.openingHours && (
          <>
            <dt>{t("place.openingHours")}</dt>
            <dd data-testid="fact-hours">{place.openingHours}</dd>
          </>
        )}
        {place.phone && (
          <>
            <dt>{t("place.phone")}</dt>
            <dd>
              <a href={`tel:${place.phone.replace(/\s+/g, "")}`}>{place.phone}</a>
            </dd>
          </>
        )}
        {website && (
          <>
            <dt>{t("place.website")}</dt>
            <dd>
              <a href={website} target="_blank" rel="noreferrer" data-testid="fact-website">
                {hostOf(website)}
              </a>
            </dd>
          </>
        )}
        {place.elevationM !== undefined && (
          <>
            <dt>{t("place.elevation")}</dt>
            <dd>{t("place.elevation.value", { metres: Math.round(place.elevationM) })}</dd>
          </>
        )}
        <dt>GPS</dt>
        <dd className="info-gps">
          <span>{gps}</span>
          {copy}
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
    </div>
  );
}
