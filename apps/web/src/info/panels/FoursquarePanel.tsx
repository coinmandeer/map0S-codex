import { t } from "../../i18n";
import { useSectionEmpty } from "../SectionAvailability";
import { useState } from "react";
import { EmptyState, Skeleton } from "../../ui/primitives";
import { safeExternalUrl } from "../detailModel";
import { useInfoData } from "../useInfoData";
import type { InfoPanelProps } from "../registry";

interface Detail {
  fsqId: string;
  name: string | null;
  categories: string[];
  address: string | null;
  website: string | null;
  tel: string | null;
  dateClosed: string | null;
  url: string;
}
function PlaceInfo({ data }: { data: Detail }) {
  const website = safeExternalUrl(data.website ?? "");
  const source = safeExternalUrl(data.url);
  return (
    <div className="info-panel" data-testid="panel-foursquare">
      <strong>{data.name ?? "Místo"}</strong>
      {data.address && <p>{data.address}</p>}
      {data.dateClosed && (
        <p className="meta">{t("polish.fsqClosed", { date: data.dateClosed })}</p>
      )}
      <div className="tag-grid">
        {data.categories.map((c, i) => (
          <span key={`${c}-${i}`} className="tag">
            {c}
          </span>
        ))}
      </div>
      {data.tel && <p>{data.tel}</p>}
      {website && (
        <a href={website} target="_blank" rel="noopener noreferrer">
          {t("polish.website")} ↗
        </a>
      )}
      {source && (
        <p>
          <a href={source} target="_blank" rel="noopener noreferrer">
            {t("polish.sources")}: Foursquare ↗
          </a>
        </p>
      )}
    </div>
  );
}
/** Mounted only by the explicit Foursquare section. Selecting a candidate reuses search data. */
export function FoursquarePanel(props: InfoPanelProps) {
  return <FoursquareLookup key={props.place.id} {...props} />;
}
function FoursquareLookup({ place, refs }: InfoPanelProps) {
  const id = place.fsqId ?? refs.fsq;
  const state = useInfoData<Detail | { candidates: Detail[] }>(
    "/info/foursquare",
    id ? { fsqId: id } : { name: place.name.slice(0, 120), lng: place.lng, lat: place.lat }
  );
  const [selected, setSelected] = useState<Detail | null>(null);
  useSectionEmpty(
    state.status === "empty" ||
      (state.status === "ready" && "candidates" in state.data && !state.data.candidates.length)
  );
  if (state.status === "loading") return <Skeleton height={96} />;
  if (state.status !== "ready")
    return (
      <EmptyState title={state.status === "error" ? state.message : "Bez záznamu na Foursquare"} />
    );
  if (selected)
    return (
      <>
        <button className="btn" onClick={() => setSelected(null)}>
          {t("polish.fsqBack")}
        </button>
        <PlaceInfo data={selected} />
      </>
    );
  if ("candidates" in state.data) {
    if (!state.data.candidates.length)
      return <EmptyState title="V okolí nebyla nalezena odpovídající místa" />;
    return (
      <div className="info-panel">
        <p>{t("polish.fsqChoose")}</p>
        {state.data.candidates.map((candidate) => (
          <button className="btn" key={candidate.fsqId} onClick={() => setSelected(candidate)}>
            {candidate.name ?? "Místo"}
            {candidate.address ? ` · ${candidate.address}` : ""}
          </button>
        ))}
        <p className="meta">{t("polish.sources")}: Foursquare</p>
      </div>
    );
  }
  return <PlaceInfo data={state.data} />;
}
