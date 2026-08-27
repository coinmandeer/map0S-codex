import { EmptyState, Skeleton } from "../../ui/primitives";
import { useInfoData } from "../useInfoData";
import type { InfoPanelProps } from "../registry";

interface Detail {
  fsqId: string;
  name: string | null;
  rating: number | null;
  ratingCount: number | null;
  price: number | null;
  hours: string | null;
  categories: string[];
  photos: string[];
  tips: Array<{ text: string }>;
  url: string;
}

export function FoursquarePanel({ place }: InfoPanelProps) {
  const state = useInfoData<Detail>(place.fsqId ? "/info/foursquare" : null, {
    fsqId: place.fsqId
  });

  if (state.status === "loading") return <Skeleton height={96} />;
  if (state.status !== "ready") {
    return (
      <EmptyState title={state.status === "error" ? state.message : "Bez záznamu na Foursquare"} />
    );
  }

  const { data } = state;
  return (
    <div className="info-panel" data-testid="panel-foursquare">
      {(data.rating !== null || data.price !== null) && (
        <p className="info-rating">
          {data.rating !== null && <strong>★ {data.rating.toFixed(1)}</strong>}
          {data.ratingCount ? <span className="meta">{data.ratingCount} hodnocení</span> : null}
          {data.price !== null && <span className="meta">{"$".repeat(data.price)}</span>}
        </p>
      )}
      {data.hours && <p className="meta">{data.hours}</p>}
      {data.categories.length > 0 && (
        <div className="tag-grid">
          {data.categories.map((c) => (
            <span key={c} className="tag">
              {c}
            </span>
          ))}
        </div>
      )}
      {data.photos.length > 0 && (
        <div className="info-photos">
          {data.photos.map((url) => (
            <img key={url} src={url} alt="" loading="lazy" />
          ))}
        </div>
      )}
      {data.tips.map((tip) => (
        <p key={tip.text} className="info-tip">
          „{tip.text}“
        </p>
      ))}
      <a className="btn" href={data.url} target="_blank" rel="noreferrer">
        Otevřít na Foursquare
      </a>
    </div>
  );
}
