import { API_BASE } from "../lib/api";
import { useEffect, useRef, useState } from "react";
import { fetchThemeUnit, type ThemeUnitDetail } from "../layers/themes/themeCatalog";
import { formatValue } from "../layers/themes/themeLayers";
import { Button, IconButton, Select, Checkbox, Skeleton } from "../ui/kit";

import { ThemesSection } from "../ui/layers/ThemesSection";
import { st } from "./labels";
import {
  returnToStatisticsView,
  activateStatistic,
  compareStatisticsRegion,
  removeStatisticsRegion,
  loadExplorerRows,
  selectStatisticsRegion,
  useStatistics,
  type ExplorerRow
} from "./explorerStore";

export function StatisticsExplorer() {
  const state = useStatistics();
  const id = state.activeId;
  const detail = id ? state.details[id] : undefined;
  const period = id ? (state.periods[id] ?? "latest") : "latest";
  const excluded = id ? (state.excluded[id] ?? []) : [];
  const excludedKey = excluded.join(",");
  const generation = useRef(0);
  const [rows, setRows] = useState<ExplorerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [facts, setFacts] = useState<ThemeUnitDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refs = [...(state.selected ? [state.selected] : []), ...state.regions].filter(
    (r, i, a) => a.findIndex((x) => x.code === r.code && x.level === r.level) === i
  );
  const refsKey = JSON.stringify(refs);
  useEffect(() => {
    generation.current++;
    const controller = new AbortController();
    setRows([]);
    setFacts([]);
    setError(null);
    if (!id) return () => controller.abort();
    setLoading(true);
    void Promise.all([
      loadExplorerRows(id, period, excluded, 0, controller.signal),
      Promise.all(
        refs.map((ref) =>
          fetchThemeUnit(id, ref.level, ref.code, {
            period,
            excluded,
            signal: controller.signal
          }).catch(() => null)
        )
      )
    ])
      .then(([table, values]) => {
        if (controller.signal.aborted) return;
        setRows(table.rows);
        setTotal(table.total);
        setFacts(values.filter((f): f is ThemeUnitDetail => f !== null));
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(st("Data se nepodařilo načíst.", "Could not load data."));
          setLoading(false);
        }
      });
    return () => controller.abort();
    // Serialized selections prevent refetches for unrelated store updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    id,
    period,
    excludedKey,
    refsKey,
    detail?.revision,
    detail?.selectedDatasetId,
    state.viewportKey
  ]);
  async function exportData() {
    if (!id) return;
    const all: ExplorerRow[] = [];
    try {
      for (let offset = 0; offset < 100000; offset += 200) {
        const page = await loadExplorerRows(id, period, excluded, offset);
        all.push(...page.rows);
        if (!page.rows.length || all.length >= page.total) break;
      }
      const cell = (value: unknown) =>
        `"${String(value ?? "")
          .replace(/^[=+@-]/, "'$&")
          .replaceAll('"', '""')}"`;
      const header = [
        "name",
        "code",
        "level",
        "value",
        "unit",
        "period",
        "flag",
        "source",
        "sourceUrl"
      ] as const;
      const csv = [
        header.join(","),
        ...all.map((row) => header.map((key) => cell(row[key])).join(","))
      ].join("\r\n");
      const url = URL.createObjectURL(
        new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `mapos-${id}-${period}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(st("Export se nezdařil.", "Export failed."));
    }
  }
  return (
    <div data-testid="statistics-explorer">
      <div className="statistics-explorer">
        <Select
          label={st("Ukazatel", "Indicator")}
          value={id}
          options={state.catalog.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(next) => void activateStatistic(next)}
        />
        {!id ? (
          <ThemesSection />
        ) : (
          <>
            <StatisticsPeriod />
            <StatisticsResolution />
            {detail?.ready && (
              <p role="status">
                {st("Rozlišení dat", "Data resolution")}:{" "}
                {detail.selectedGeoLevel === "lau"
                  ? st("obce (LAU)", "municipalities (LAU)")
                  : detail.selectedGeoLevel === "country"
                    ? st("celé státy", "whole countries")
                    : detail.selectedGeoLevel === "nuts2"
                      ? st("regiony NUTS 2 · v ČR 8 regionů soudržnosti", "NUTS 2 regions")
                      : detail.selectedGeoLevel === "nuts3"
                        ? st("regiony NUTS 3 · v ČR kraje", "NUTS 3 regions")
                        : detail.selectedGeoLevel?.toUpperCase()}
              </p>
            )}
            {state.returnBbox && (
              <Button variant="text" onClick={returnToStatisticsView}>
                {st("Zpět na původní výřez", "Return to previous view")}
              </Button>
            )}
            {state.loading || loading ? <Skeleton count={2} /> : null}
            {(state.error || error) && <p role="alert">{state.error ?? error}</p>}
            {detail && !detail.ready && (
              <p role="status">
                {st(
                  "Tato statistika pro zvolené období a zdroje zatím nemá publikované hodnoty s odpovídajícími hranicemi. Vyberte jinou statistiku nebo období.",
                  "This statistic has no published values with matching boundaries for the selected year and sources. Choose another statistic or year."
                )}
              </p>
            )}
            {period === "latest" && rows.length > 0 && (
              <p>
                {st("Použitá období", "Years used")}:{" "}
                {[...new Set(rows.map((r) => r.period))].sort().join(", ")}
              </p>
            )}
            {detail?.disclosure && <p className="statistics-methodology">{detail.disclosure}</p>}
            {facts.map((f) => (
              <section key={`${f.geoLevel}:${f.code}`} className="statistics-fact">
                <h3>{f.name}</h3>
                <p>
                  <strong>
                    {f.value === null ? st("Bez dat", "No data") : formatValue(f.value)}
                  </strong>{" "}
                  {f.unit} · {f.period} {f.flag ? `(${f.flag})` : ""}
                </p>
                {f.rank !== null && (
                  <p>
                    {st("Pořadí podle hodnoty", "Rank by value")}: {f.rank} / {f.of} ·{" "}
                    {f.geoLevel.toUpperCase()}
                  </p>
                )}
                <SeriesChart series={f.series} />
                <small>
                  {f.source.name} · {f.source.attribution}
                </small>
                <Button
                  variant="text"
                  onClick={() =>
                    compareStatisticsRegion({ code: f.code, level: f.geoLevel, name: f.name })
                  }
                >
                  {st("Porovnat", "Compare")}
                </Button>
              </section>
            ))}
            {!!state.regions.length && (
              <section>
                <h3>{st("Porovnání území", "Compare territories")}</h3>
                {state.regions.map((r) => (
                  <div key={`${r.level}:${r.code}`}>
                    {r.name}
                    <IconButton
                      icon="close"
                      label={st("Odebrat", "Remove")}
                      onClick={() => removeStatisticsRegion(r.code, r.level)}
                    />
                  </div>
                ))}
              </section>
            )}
            <section>
              <h3>
                {st("Hodnoty a území", "Values and territories")} ({total})
              </h3>
              <Button variant="text" icon="download" onClick={() => void exportData()}>
                {st("Exportovat CSV", "Export CSV")}
              </Button>
              <div className="statistics-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{st("Území", "Territory")}</th>
                      <th>{detail?.unit}</th>
                      <th>{st("Období", "Period")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.level}:${r.code}`}>
                        <td>
                          <Button variant="text" onClick={() => selectStatisticsRegion(r)}>
                            {r.name}
                          </Button>
                        </td>
                        <td>
                          {r.value === null ? "—" : formatValue(r.value)}
                          {r.flag ? (
                            <abbr title={r.flag} aria-label={r.flag}>
                              {" "}
                              {r.flag.length > 8 ? "ⓘ" : `(${r.flag})`}
                            </abbr>
                          ) : null}
                        </td>
                        <td>{r.period}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length < total && (
                <Button
                  variant="text"
                  onClick={() => {
                    const token = generation.current;
                    void loadExplorerRows(id, period, excluded, rows.length)
                      .then((p) => {
                        if (token === generation.current) setRows((old) => [...old, ...p.rows]);
                      })
                      .catch(() => setError(st("Načtení selhalo.", "Loading failed.")));
                  }}
                >
                  {st("Další území", "More territories")}
                </Button>
              )}
            </section>
            <section>
              <h3>{st("Zdroje a metodika", "Sources and methodology")}</h3>
              <p>
                {detail?.geometryProfile === "noncommercial"
                  ? st(
                      "Regionální geometrie může mít nekomerční podmínky.",
                      "Regional geometries may have noncommercial terms."
                    )
                  : st(
                      "Hranice států: Natural Earth. Hranice obcí: publikovaná edice GISCO LAU 2024. Chybějící místní hodnoty neodhadujeme ze státních průměrů.",
                      "Country boundaries: Natural Earth. Municipal boundaries: the published GISCO LAU 2024 edition. Missing local observations are not estimated from country averages."
                    )}
              </p>
              <a href={`${API_BASE}/v2/themes/operations`} target="_blank" rel="noreferrer">
                {st("Provozní záznam všech zdrojů", "All source import records")}
              </a>
              {detail?.sources.map((source) => (
                <div className="statistics-source" key={source.datasetId}>
                  <Checkbox
                    checked={!excluded.includes(source.datasetId)}
                    label={source.name}
                    onChange={(checked) =>
                      void activateStatistic(
                        id,
                        period,
                        checked
                          ? excluded.filter((x) => x !== source.datasetId)
                          : [...excluded, source.datasetId]
                      )
                    }
                  />
                  <a href={source.documentationUrl} target="_blank" rel="noreferrer">
                    {source.attribution} · {source.license}
                  </a>
                  <small>{source.geoLevel.toUpperCase()}</small>
                  {detail.imports
                    ?.filter((r) => r.dataset_id === source.datasetId)
                    .map((r) => (
                      <small key={r.dataset_id}>
                        {r.published_at
                          ? `${st("Import", "Imported")}: ${r.published_at.slice(0, 10)} · ${r.territories} ${st("území", "territories")} · ${r.unmatched} ${st("bez propojené geometrie", "without matching geometry")}`
                          : st("Dosud neimportováno", "Not yet imported")}
                        {r.error && <span role="status">{r.error}</span>}
                      </small>
                    ))}
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
const resolutionLabel = (level: string) =>
  (
    ({
      country: "Státy",
      nuts0: "Státy (NUTS 0)",
      nuts1: "Velké regiony (NUTS 1)",
      nuts2: "Regiony (NUTS 2; ČR 8 regionů soudržnosti)",
      nuts3: "Menší regiony (NUTS 3; ČR kraje)",
      lau: "Obce (LAU)",
      adm1: "Správní regiony"
    }) as Record<string, string>
  )[level] ?? level;
function StatisticsResolution() {
  const state = useStatistics(),
    id = state.activeId,
    detail = id ? state.details[id] : undefined;
  if (!id || !detail) return null;
  const published = detail.sources.filter((s) => s.available === true),
    levels = [...new Set(published.map((s) => s.geoLevel))];
  if (levels.length < 2) return null;
  const excluded = state.excluded[id] ?? [];
  const selected = levels.find((level) =>
    detail.sources.every(
      (source) => excluded.includes(source.datasetId) === (source.geoLevel !== level)
    )
  );
  const value = !excluded.length ? "auto" : (selected ?? "custom");
  return (
    <Select
      label={st("Územní podrobnost", "Territorial resolution")}
      value={value}
      options={[
        { value: "auto", label: st("Automaticky · všechny zdroje", "Automatic · all sources") },
        ...(value === "custom"
          ? [{ value: "custom", label: st("Vlastní výběr zdrojů", "Custom sources") }]
          : []),
        ...levels.map((value) => ({ value, label: resolutionLabel(value) }))
      ]}
      onChange={(level) => {
        if (level !== "custom")
          void activateStatistic(
            id,
            state.periods[id] ?? "latest",
            level === "auto"
              ? []
              : detail.sources.filter((s) => s.geoLevel !== level).map((s) => s.datasetId),
            { reveal: false, fitCoverage: false }
          );
      }}
    />
  );
}
export function StatisticsPeriod() {
  const state = useStatistics();
  const id = state.activeId;
  const detail = id ? state.details[id] : undefined;
  if (!id || !detail) return null;
  return (
    <Select
      label={st("Období statistiky", "Statistical period")}
      value={state.periods[id] ?? "latest"}
      options={[
        { value: "latest", label: st("Poslední dostupné", "Latest available") },
        ...detail.periods.map((value) => ({ value, label: value }))
      ]}
      onChange={(period) => void activateStatistic(id, period)}
    />
  );
}
function SeriesChart({ series }: { series: ThemeUnitDetail["series"] }) {
  const years = series.map((p) => Number(p.period));
  const values = series.flatMap((p) => (p.value === null ? [] : [p.value]));
  if (years.some((y) => !Number.isFinite(y)) || years.length < 2 || !values.length) return null;
  const min = Math.min(...values),
    span = Math.max(...values) - min;
  const start = Math.min(...years),
    end = Math.max(...years);
  const segments: string[] = [];
  let segment = "";
  series.forEach((p, i) => {
    if (p.flag?.includes("b") || (i > 0 && years[i]! - years[i - 1]! > 1)) {
      if (segment) segments.push(segment);
      segment = "";
    }
    if (p.value === null) {
      if (segment) segments.push(segment);
      segment = "";
      return;
    }
    const x = ((years[i]! - start) / (end - start || 1)) * 280 + 10;
    const y = span ? 80 - ((p.value - min) / span) * 70 : 45;
    segment += `${segment ? "L" : "M"}${x},${y} `;
  });
  if (segment) segments.push(segment);
  return (
    <figure className="statistics-chart">
      <svg viewBox="0 0 300 100" role="img" aria-label={st("Vývoj v čase", "Time series")}>
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="2" />
        ))}
        <text x="10" y="98">
          {start}
        </text>
        <text x="260" y="98">
          {end}
        </text>
      </svg>
    </figure>
  );
}
