import { t } from "../../i18n";
import { useSectionEmpty } from "../SectionAvailability";
import { Fragment } from "react";
import { EmptyState, Skeleton } from "../../ui/primitives";
import { useInfoData } from "../useInfoData";
import type { InfoPanelProps } from "../registry";

interface Facts {
  qid: string;
  label: string;
  description: string | null;
  url: string;
  facts: Array<{ label: string; value: string }>;
  sitelinks: number;
}

export function WikidataPanel({ place }: InfoPanelProps) {
  const state = useInfoData<Facts>(place.wikidata ? "/info/wikidata" : null, {
    qid: place.wikidata
  });

  useSectionEmpty(
    state.status === "empty" ||
      (state.status === "ready" && !state.data.description && !state.data.facts.length)
  );
  if (state.status === "loading") return <Skeleton height={72} />;
  if (state.status !== "ready") {
    return (
      <EmptyState title={state.status === "error" ? state.message : "Bez strukturovaných dat"} />
    );
  }

  const { data } = state;
  return (
    <div className="info-panel" data-testid="panel-wikidata">
      {data.description && <p>{data.description}</p>}
      {data.facts.length ? (
        <dl className="info-facts">
          {data.facts.map((fact) => (
            <Fragment key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className="meta">Wikidata k tomuto místu neuvádí žádné z podporovaných tvrzení.</p>
      )}
      <p className="meta">{t("polish.wikidataVersions", { count: data.sitelinks })}</p>
      <a className="btn" href={data.url} target="_blank" rel="noreferrer">
        {data.qid} · Wikidata
      </a>
    </div>
  );
}
