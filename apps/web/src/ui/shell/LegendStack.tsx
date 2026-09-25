import { useEffect, useId, useState, type CSSProperties } from "react";
import { t } from "../../i18n";
import { getShellStore } from "../../store/shellStore";
import type { LegendContributionRef } from "../footerContributions";
import { Dialog, IconButton } from "../kit";
import {
  legendCompactDescription,
  legendTextEntries,
  legendVisual,
  type LegendVisual
} from "../legendPresentation";

/** Rows the footer shows before it defers the rest to the dialog (§4.11). */
const ROW_CAPACITY = 3;

export function LegendStack({ legends }: { legends: LegendContributionRef[] }) {
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const detailsId = useId();
  const multiple = legends.length > 1;
  const longSingle = legends.length === 1 && legendTextEntries(legends[0]!.legend).length > 4;
  const expandable = multiple || longSingle;
  const rows = legends.slice(0, ROW_CAPACITY);
  const overflow = legends.length - rows.length;

  useEffect(() => {
    if (!expandable) setExpanded(false);
  }, [expandable]);

  if (!legends.length) return null;

  const heading = multiple ? t("footer.legends", { count: legends.length }) : legends[0]!.title;
  const description = multiple
    ? t("footer.legends.description")
    : legendCompactDescription(legends[0]!.legend);

  return (
    <section
      className="legend-tray"
      data-testid="legend-stack"
      aria-label={t("footer.legend.mapLegends")}
    >
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
            {expanded
              ? t("footer.legend.hideDetail")
              : multiple
                ? t("footer.legend.showAll", { count: legends.length })
                : t("footer.legend.detail")}
          </button>
        )}
        {/* Rolling the key up leaves the colours on the map: this hides an explanation, it does
            not turn a layer off, which is why it lives here and not next to the layer switch. */}
        <IconButton
          icon="close_fullscreen"
          label={t("footer.minimize")}
          size="sm"
          testId="footer-minimize-legend"
          onClick={() => getShellStore().setFooterMinimized("legend", true)}
        />
      </div>

      <div
        id={detailsId}
        className={`legend-detail${expanded ? " expanded" : " compact"}`}
        data-testid="legend-detail"
        role="list"
      >
        {rows.map((contribution) => (
          <LegendLayer key={contribution.id} contribution={contribution} compact={!expanded} />
        ))}
      </div>

      {overflow > 0 && (
        <button
          type="button"
          className="legend-expand-btn"
          data-testid="legend-open-all"
          onClick={() => setDialogOpen(true)}
        >
          {t("footer.legend.more", { count: overflow })}
        </button>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("footer.legend.dialogTitle")}
        testId="legend-dialog"
      >
        <div className="legend-detail expanded" role="list">
          {legends.map((contribution) => (
            <LegendLayer key={contribution.id} contribution={contribution} compact={false} />
          ))}
        </div>
      </Dialog>
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
  return (
    <article className="legend-layer" role="listitem" data-layer-id={contribution.layerId}>
      <h3>{contribution.title}</h3>
      {compact ? (
        <LegendVisualRow visual={legendVisual(contribution.legend)} />
      ) : entries.length ? (
        <ul className="legend-values">
          {entries.map((entry, index) => (
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
        </ul>
      ) : (
        <p className="meta">{legendCompactDescription(contribution.legend)}</p>
      )}
    </article>
  );
}

function LegendVisualRow({ visual }: { visual: LegendVisual }) {
  if (visual.kind === "gradient") {
    return (
      <div className="legend-gradient">
        <span
          className="legend-gradient-bar"
          aria-hidden="true"
          style={
            {
              "--legend-ramp": `linear-gradient(90deg, ${visual.colors.join(", ")})`
            } as CSSProperties
          }
        />
        <span className="legend-gradient-bounds">
          {visual.min} – {visual.max}
        </span>
      </div>
    );
  }

  if (visual.kind === "sizes") {
    return (
      <ul className="legend-values legend-sizes">
        {visual.entries.map((entry, index) => (
          <li key={entry.label}>
            <span
              className="legend-size-dot"
              aria-hidden="true"
              style={
                {
                  "--legend-color": entry.color ?? "currentColor",
                  "--legend-size": `${6 + index * 4}px`
                } as CSSProperties
              }
            />
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (visual.kind === "swatches") {
    return (
      <ul className="legend-values">
        {visual.entries.map((entry) => (
          <li key={entry.label}>
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
        {visual.overflow > 0 && <li className="legend-more">+{visual.overflow}</li>}
      </ul>
    );
  }

  return <p className="meta">{visual.description}</p>;
}
