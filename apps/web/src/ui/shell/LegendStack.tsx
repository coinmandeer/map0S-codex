import { useEffect, useId, useState, type CSSProperties } from "react";
import type { LegendContributionRef } from "../footerContributions";
import { legendCompactDescription, legendTextEntries } from "../legendPresentation";

const COMPACT_ENTRY_CAPACITY = 4;

export function LegendStack({ legends }: { legends: LegendContributionRef[] }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const multiple = legends.length > 1;
  const longSingle = legends.length === 1 && legendTextEntries(legends[0]!.legend).length > 4;
  const expandable = multiple || longSingle;

  useEffect(() => {
    if (!expandable) setExpanded(false);
  }, [expandable]);

  if (!legends.length) return null;

  const heading = multiple ? `${legends.length} legendy` : legends[0]!.title;
  const description = multiple
    ? "Aktivní tematické vrstvy"
    : legendCompactDescription(legends[0]!.legend);

  return (
    <section className="legend-tray" data-testid="legend-stack" aria-label="Legendy mapy">
      <div className="legend-tray-summary" aria-live="polite">
        <span className="legend-tray-copy">
          <strong>{heading}</strong>
          <small>{description}</small>
        </span>
        {expandable && (
          <button
            type="button"
            className="legend-expand-btn"
            data-testid="legend-expand"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Skrýt detail" : multiple ? `Zobrazit ${legends.length} legendy` : "Detail"}
          </button>
        )}
      </div>

      {expanded || !expandable ? (
        <div
          id={detailsId}
          className={`legend-detail${expanded ? " expanded" : " compact"}`}
          data-testid="legend-detail"
          role="list"
        >
          {legends.map((contribution) => (
            <LegendLayer key={contribution.id} contribution={contribution} compact={!expanded} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function LegendLayer({
  contribution,
  compact
}: {
  contribution: LegendContributionRef;
  compact: boolean;
}) {
  const entries = legendTextEntries(contribution.legend);
  const visibleEntries = compact ? entries.slice(0, COMPACT_ENTRY_CAPACITY) : entries;
  return (
    <article className="legend-layer" role="listitem" data-layer-id={contribution.layerId}>
      <h3>{contribution.title}</h3>
      {visibleEntries.length ? (
        <ul className="legend-values">
          {visibleEntries.map((entry, index) => (
            <li key={`${entry.label}:${index}`}>
              {entry.icon ? (
                <span className="legend-icon" aria-hidden="true">
                  {entry.icon}
                </span>
              ) : entry.color ? (
                <span
                  className="legend-swatch"
                  aria-hidden="true"
                  style={{ "--legend-color": entry.color } as CSSProperties}
                />
              ) : null}
              <span>{entry.label}</span>
            </li>
          ))}
          {compact && entries.length > visibleEntries.length ? (
            <li className="legend-more">+{entries.length - visibleEntries.length} dalších</li>
          ) : null}
        </ul>
      ) : (
        <p className="meta">{legendCompactDescription(contribution.legend)}</p>
      )}
    </article>
  );
}
