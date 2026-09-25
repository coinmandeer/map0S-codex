import { LayerRow } from "./LayerRow";
import { LayerSourceInfo } from "./PoiLayerRow";
import { getLayerManifestV2 } from "../../layers/registry";
import {
  fetchUserTables,
  refreshTableLayers,
  tableLayerId,
  type UserTableSummary
} from "../../layers/themes/tableLayers";
import { useEffect, useState } from "react";
import { t } from "../../i18n";
import type { ThemeViewportSource } from "../../layers/themes/themeCatalog";
import { themeLayerId } from "../../layers/themes/themeLayers";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Skeleton, SearchField } from "../kit";
import {
  activateStatistic,
  deactivateStatistic,
  useStatistics
} from "../../statistics/explorerStore";
import { groupLabel, st } from "../../statistics/labels";

export function ThemesSection({
  query = "",
  onlyActive = false
}: { query?: string; onlyActive?: boolean } = {}) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const state = useStatistics();
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const [search, setSearch] = useState("");
  const [tables, setTables] = useState<UserTableSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    void refreshTableLayers()
      .then(() => fetchUserTables())
      .then((t) => {
        if (!cancelled) setTables(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const groups = [...new Set(state.catalog.map((t) => t.group ?? "other"))];
  if (!state.catalog.length)
    return state.error ? <p role="alert">{state.error}</p> : <Skeleton count={3} />;
  return (
    <div className="statistics-catalog" data-testid="themes-section">
      {!!tables.length && (
        <section>
          <h3>{st("Vlastní tabulky", "Your tables")}</h3>
          {tables
            .filter(
              (table) =>
                (!onlyActive || active[tableLayerId(table.id)]?.visible) &&
                normalize(table.name).includes(query)
            )
            .map((table) => (
              <LayerRow
                key={table.id}
                id={tableLayerId(table.id)}
                name={table.name}
                icon="bar_chart"
                active={!!active[tableLayerId(table.id)]?.visible}
                onChange={() => getMapStore().toggleLayer(tableLayerId(table.id))}
              >
                <LayerSourceInfo
                  legend={getLayerManifestV2(tableLayerId(table.id))?.legend}
                  attribution={getLayerManifestV2(tableLayerId(table.id))?.attribution ?? []}
                />
              </LayerRow>
            ))}
        </section>
      )}
      <p className="statistics-help">
        {st(
          "Jedna statistika na mapě. Tečka označuje pokrytí posledních dostupných dat v aktuálním výřezu: zelená dostupné, žlutá částečné, červená bez dat.",
          "One statistic on the map. Latest available data in this view: green available, yellow partial, red no data."
        )}
      </p>
      {!query && (
        <SearchField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          label={st("Hledat statistiku", "Search statistics")}
        />
      )}
      {groups.map((group) => {
        const themes = state.catalog.filter(
          (t) =>
            (t.group ?? "other") === group &&
            normalize(t.name).includes(normalize(search)) &&
            normalize(`${t.name} ${groupLabel(group)}`).includes(query) &&
            (!onlyActive || Boolean(active[themeLayerId(t.id)]?.visible))
        );
        if (!themes.length) return null;
        return (
          <section key={group}>
            <h3>{groupLabel(group)}</h3>
            {themes.map((theme) => {
              const enabled = state.loading
                ? state.activeId === theme.id
                : Boolean(active[themeLayerId(theme.id)]?.visible);
              const status = theme.coverageStatus ?? "unknown";
              const available = theme.available !== false && status !== "none";
              const coverageLabel =
                status === "full"
                  ? st("Data pro celý výřez", "Data throughout this view")
                  : status === "partial"
                    ? st("Částečné pokrytí výřezu", "Partial coverage in this view")
                    : status === "none"
                      ? st(
                          "Pro tento výřez nejsou připravená data",
                          "No prepared data in this view"
                        )
                      : st("Pokrytí se ověřuje", "Checking coverage");
              return (
                <LayerRow
                  key={theme.id}
                  id={themeLayerId(theme.id)}
                  name={theme.name}
                  icon="bar_chart"
                  active={enabled}
                  summary={theme.unit}
                  notice={!available ? coverageLabel : undefined}
                  disabled={!available && !enabled}
                  testId={`theme-switch-${theme.id}`}
                  onChange={(next) =>
                    next ? void activateStatistic(theme.id) : deactivateStatistic()
                  }
                >
                  <p>{coverageLabel}</p>
                  <LayerSourceInfo
                    legend={getLayerManifestV2(themeLayerId(theme.id))?.legend}
                    attribution={getLayerManifestV2(themeLayerId(theme.id))?.attribution ?? []}
                  />
                </LayerRow>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/** How much of the view a source answers for, as a sentence rather than a number. */
export function shareLabel(source: ThemeViewportSource): string {
  if (source.share === null) return t("themes.source.notCovering");
  const percent = Math.round(source.share * 100);
  const period =
    source.periodFrom && source.periodTo
      ? source.periodFrom === source.periodTo
        ? ` · ${source.periodTo}`
        : ` · ${source.periodFrom}–${source.periodTo}`
      : "";
  return `${source.geoLevel.toUpperCase()}${period} · ${t("themes.source.coverage", { percent })}`;
}
