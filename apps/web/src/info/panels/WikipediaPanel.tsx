import { EmptyState, Skeleton } from "../../ui/primitives";
import { useInfoData } from "../useInfoData";
import type { InfoPanelProps } from "../registry";

interface Article {
  lang: string;
  title: string;
  extract: string;
  url: string;
  thumbnail: string | null;
}

export function WikipediaPanel({ place }: InfoPanelProps) {
  // The QID resolves to the right article in the right language; the name is the fallback for
  // places OSM knows but Wikidata has never heard of.
  const state = useInfoData<Article>("/info/wikipedia", {
    qid: place.wikidata,
    title: place.name
  });

  if (state.status === "loading") return <Skeleton height={96} />;
  if (state.status === "empty") {
    return <EmptyState title="K tomuto místu zatím žádný článek není" />;
  }
  if (state.status === "error") return <EmptyState title={state.message} />;

  const article = state.data;
  return (
    <div className="info-panel" data-testid="panel-wikipedia">
      {article.thumbnail && <img className="info-thumb" src={article.thumbnail} alt="" />}
      <h4>{article.title}</h4>
      <p>{article.extract}</p>
      <a className="btn" href={article.url} target="_blank" rel="noreferrer">
        Číst na Wikipedii
      </a>
      <p className="meta">Wikipedia ({article.lang}) — CC BY-SA</p>
    </div>
  );
}
