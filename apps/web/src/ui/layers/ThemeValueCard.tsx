import { activateStatistic, showStatistics } from "../../statistics/explorerStore";
import { useEffect, useState } from "react";
import { on } from "../../lib/events";
import { getLayerManifestV2 } from "../../layers/registry";
import { fetchThemeUnit, type ThemeUnitDetail } from "../../layers/themes/themeCatalog";
import { formatValue, themeLayerId } from "../../layers/themes/themeLayers";
import { IconButton, Skeleton } from "../kit";
import { t } from "../../i18n";

/**
 * What a tapped territory says.
 *
 * A number on its own is close to useless in a thematic map — nobody carries "offences per
 * hundred thousand" around as an intuition. The rank turns it into a comparison and the
 * sparkline turns it into a direction, and both come from the same request as the value, so
 * the card never shows a figure it cannot place.
 */
export function ThemeValueCard() {
  const [detail, setDetail] = useState<ThemeUnitDetail | null>(null);
  const [pending, setPending] = useState<{ themeId: string; name: string } | null>(null);

  useEffect(
    () =>
      on("theme-unit-selected", (event) => {
        setPending({ themeId: event.themeId, name: event.name });
        setDetail(null);
        void fetchThemeUnit(event.themeId, event.geoLevel, event.code, {
          excluded: excludedOf(event.themeId)
        })
          .then((loaded) => setDetail(loaded))
          // A territory with no value is a legitimate answer to a click on the hatch, and the
          // card closing again says that more clearly than an error would.
          .catch(() => setPending(null));
      }),
    []
  );

  if (!pending) return null;

  return (
    <aside className="theme-value-card" data-testid="theme-value-card">
      <header>
        <span className="theme-value-name">{detail?.name ?? pending.name}</span>
        <IconButton
          icon="close"
          label={t("panel.close")}
          size="sm"
          testId="theme-value-close"
          onClick={() => {
            setPending(null);
            setDetail(null);
          }}
        />
      </header>
      {!detail ? (
        <Skeleton count={2} height={28} />
      ) : (
        <>
          <p
            className="theme-value-figure"
            role="button"
            tabIndex={0}
            onClick={() => {
              void activateStatistic(pending.themeId, undefined, undefined, { reveal: true });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") showStatistics(true);
            }}
          >
            <strong>{detail.value === null ? "bez dat" : formatValue(detail.value)}</strong>
            <span>{detail.unit}</span>
          </p>
          <p className="theme-value-meta" data-testid="theme-value-rank">
            {rankLabel(detail)}
          </p>
          <Sparkline series={detail.series} period={detail.period} />
          <p className="theme-value-source">
            {detail.source.name} · {detail.source.attribution} · {detail.period}
          </p>
        </>
      )}
    </aside>
  );
}

export function rankLabel(detail: ThemeUnitDetail): string {
  if (detail.rank === null || !detail.of)
    return t("themes.value.period", { period: detail.period });
  return t("themes.value.rank", { rank: detail.rank, of: detail.of, period: detail.period });
}

/**
 * The series as a polyline in a 100×28 viewbox.
 *
 * Deliberately unlabelled: with four to ten yearly points, axes would take more room than the
 * shape and the shape is the whole message. The current period is marked so the value above is
 * locatable on the line.
 */
export function sparklinePoints(
  series: ReadonlyArray<{ period: string; value: number | null }>
): string {
  const values = series.filter(
    (entry): entry is { period: string; value: number } => typeof entry.value === "number"
  );
  if (values.length < 2) return "";
  const numbers = values.map((entry) => entry.value);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const span = max - min;
  return values
    .map((entry, index) => {
      const x = (index / (values.length - 1)) * 100;
      // A series that never moved has no range to scale by. Down the middle says "flat"; at the
      // bottom, where a zero-span division would land it, says "lowest possible", which is a
      // claim the data does not make.
      const y = span === 0 ? 14 : 26 - ((entry.value - min) / span) * 24;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function Sparkline({
  series,
  period
}: {
  series: ReadonlyArray<{ period: string; value: number | null }>;
  period: string;
}) {
  const points = sparklinePoints(series);
  if (!points) return null;
  const measured = series.filter((entry) => typeof entry.value === "number");
  return (
    <svg
      className="theme-sparkline"
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Vývoj ${measured[0]?.period ?? ""}–${measured[measured.length - 1]?.period ?? period}`}
      data-testid="theme-sparkline"
    >
      <polyline points={points} fill="none" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Which sources the layer is currently drawn without, read back from its tile URL. */
function excludedOf(themeId: string): string[] {
  const template = getLayerManifestV2(themeLayerId(themeId))?.source.tileTemplate;
  if (!template) return [];
  const query = template.split("?")[1];
  if (!query) return [];
  const exclude = new URLSearchParams(query).get("exclude");
  return exclude ? exclude.split(",").filter(Boolean) : [];
}
