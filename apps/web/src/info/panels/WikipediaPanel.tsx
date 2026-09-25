import { t } from "../../i18n";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { useSectionEmpty } from "../SectionAvailability";
import { wikipediaIdentity } from "../wikipediaIdentity";
import { EmptyState, Skeleton } from "../../ui/primitives";
import { safeExternalUrl } from "../detailModel";
import { useInfoData } from "../useInfoData";
import type { InfoPanelProps } from "../registry";

interface Article {
  lang: string;
  title: string;
  extract: string;
  url: string;
  thumbnail: string | null;
}

export function WikipediaPanel({ place, refs }: InfoPanelProps) {
  const lowData = useMapStoreSnapshot((state) => state.preferences.lowData);
  const identity = wikipediaIdentity(place.wikidata ?? refs.wikidata, refs.wikipedia);
  const state = useInfoData<Article>(identity ? "/info/wikipedia" : null, identity ?? {});

  useSectionEmpty(state.status === "empty" || (state.status === "ready" && !state.data.extract));
  if (state.status === "loading") return <Skeleton height={96} />;
  if (state.status === "empty") {
    return <EmptyState title="K tomuto místu zatím nemáme ověřený odkaz na článek" />;
  }
  if (state.status === "error") return <EmptyState title={state.message} />;

  const article = state.data;
  const thumbnail = safeExternalUrl(article.thumbnail);
  return (
    <div className="info-panel" data-testid="panel-wikipedia">
      {thumbnail && !lowData && (
        <img
          className="info-thumb"
          src={thumbnail}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <h4>{article.title}</h4>
      <p>{article.extract}</p>
      <a className="btn" href={article.url} target="_blank" rel="noreferrer">
        {t("polish.readWiki")}
      </a>
      <p className="meta">Wikipedia ({article.lang}) — CC BY-SA</p>
    </div>
  );
}
