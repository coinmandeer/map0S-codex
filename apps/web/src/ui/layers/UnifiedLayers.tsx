import { useFavoriteLayers } from "./useFavoriteLayers";
import { useCatalogActions } from "./useCatalogActions";
import { CzechSubgroups } from "./CzechSubgroups";
import { consumeLayerSettingsRequest } from "./useFavoriteLayers";
import { catalogEvidence } from "./catalogEvidence";
import { layerUnavailableReason } from "../../layers/registry";
import { useStatistics } from "../../statistics/explorerStore";
import { themeLayerId } from "../../layers/themes/themeLayers";
import { Fragment, useEffect, useMemo, useState } from "react";
import { allLayerPlugins, getLayerPlugin } from "../../layers";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { on } from "../../lib/events";
import { st } from "../../statistics/labels";
import { Button, EmptyState, Icon, IconButton, SearchField, Select, Switch } from "../kit";
import { LayerActivityBadge, useLayerActivity } from "./LayerActivityBadge";
import { activityLabel } from "../../tasks/layerActivity";
import {
  CATALOG_GROUPS,
  catalogItemState,
  type CatalogGroup,
  type CatalogItem,
  type RelatedRef
} from "./catalogModel";
import { PoiLayerRow } from "./PoiLayerRow";
import { WeatherLayerSettings } from "./WeatherLayerSettings";
import { isWeatherLayerId } from "../../layers/weather/controls";
import { WorldSection } from "./WorldSection";
import { SavePresetDialog } from "./SavePresetDialog";
import { MAP_PRESETS } from "../presets";
import { loadUserPresets } from "../userPresets";
import { poiCategoryIcon, layerIcon } from "./layerPresentation";
import { showStatistics } from "../../statistics/explorerStore";

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const normalize = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const relatedLayerId = (ref: RelatedRef) => (typeof ref === "string" ? ref : ref.layer);
/** `related` mixes plain layer ids with facet objects; both have to reach the search index as
 *  text, or an object would match every query as "[object Object]". */
const relatedText = (ref: RelatedRef) =>
  typeof ref === "string"
    ? ref
    : [ref.layer, ref.cs, ref.en, ...(ref.values ?? [])].filter(Boolean).join(" ");

function itemSearchText(item: CatalogItem, group: CatalogGroup): string {
  return normalize(
    `${item.cs} ${item.en} ${item.layer} ${group.cs} ${group.en} ${
      getLayerPlugin(item.layer)
        ?.attribution?.map((a) => a.label)
        .join(" ") ?? ""
    } ${(item.related ?? []).map(relatedText).join(" ")}`
  );
}

/** The live load state of a layer, inline under its name: a spinner phase says "Načítám…", a
 *  finished-but-empty or zoom-gated layer says why. The ready phase stays silent. */
function LayerStatus({ id, enabled = true }: { id: string; enabled?: boolean }) {
  const active = useMapStoreSnapshot((s) => Boolean(s.activeLayers[id]?.visible));
  const activity = useLayerActivity(id);
  if (!enabled || !active || !activity || activity.phase === "ready" || activity.phase === "off")
    return null;
  const busy = ["queued", "loading", "rendering"].includes(activity.phase);
  return (
    <small className="catalog-status" data-phase={activity.phase}>
      {busy ? st("Načítám…", "Loading…") : activityLabel(activity)}
    </small>
  );
}

export function UnifiedLayers() {
  const store = getMapStore();
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const zoom = useMapStoreSnapshot((s) => s.view.zoom);
  const statistics = useStatistics();
  const [view, setView] = useState<"all" | "active" | "favorites" | "mine">("all");
  const [availableHere, setAvailableHere] = useState(false);
  const [activeOpen, setActiveOpen] = useState(false);
  const { favorites, toggleFavorite } = useFavoriteLayers();
  const { reasonFor, change } = useCatalogActions();
  const layers = useMapStoreSnapshot((s) => s.activeLayers);
  const presetId = useMapStoreSnapshot((s) => s.activePresetId);
  const [query, setQuery] = useState(() => read("mapos:catalog-query", ""));
  const [open, setOpen] = useState<string[]>(() => read("mapos:catalog-sections", []));
  const [revealItem, setRevealItem] = useState<{ id: string } | null>(null);
  const [settings, setSettings] = useState<string | null>(null);
  const [save, setSave] = useState(false);
  const [sources, setSources] = useState(false);
  // Bumped when a plugin registers/unregisters so the derived catalogue picks up new layers.
  const [version, setVersion] = useState(0);
  useEffect(() => on("layers-changed", () => setVersion((v) => v + 1)), []);
  useEffect(() => {
    try {
      sessionStorage.setItem("mapos:catalog-query", JSON.stringify(query));
      sessionStorage.setItem("mapos:catalog-sections", JSON.stringify(open));
    } catch {
      /* storage can be unavailable; the drawer still works without it */
    }
  }, [query, open]);

  // localStorage-backed, plugin-list-backed and catalogue-derived lists are all computed once per
  // relevant change instead of on every keystroke and every layer toggle. `version`/`save` are
  // cache keys for the mutable plugin registry and for saved presets, not values used below.
  const presets = useMemo(() => {
    void version;
    void save;
    return [...MAP_PRESETS, ...loadUserPresets()];
  }, [version, save]);
  const { groups, unique } = useMemo(() => {
    void version;
    const known = new Set(CATALOG_GROUPS.flatMap((g) => g.items.map((i) => i.layer)));
    const extras: CatalogItem[] = allLayerPlugins()
      .filter(
        (p) =>
          !known.has(p.manifest.id) &&
          !p.manifest.id.startsWith("theme-") &&
          p.manifest.id !== "vanlife"
      )
      .map((p) => ({
        id: p.manifest.id,
        layer: p.manifest.id,
        cs: p.manifest.name,
        en: p.manifest.name
      }));
    const groups: CatalogGroup[] = CATALOG_GROUPS.map((g) =>
      g.id === "mine"
        ? {
            ...g,
            items: [
              ...g.items,
              ...extras.filter(
                (i) =>
                  !CATALOG_GROUPS.some((group) =>
                    group.items.some((row) =>
                      row.related?.some((ref) => relatedLayerId(ref) === i.layer)
                    )
                  )
              )
            ]
          }
        : g.id === "society"
          ? {
              ...g,
              items: statistics.catalog.map((t) => ({
                id: themeLayerId(t.id),
                layer: themeLayerId(t.id),
                cs: t.name,
                en: `${t.name} ${t.id} ${t.group ?? ""}`,
                icon: "bar_chart" as const
              }))
            }
          : {
              ...g,
              items: [
                ...g.items,
                ...extras.filter((i) =>
                  g.items.some((row) => row.related?.some((ref) => relatedLayerId(ref) === i.layer))
                )
              ].filter((item, index, all) => all.findIndex((i) => i.id === item.id) === index)
            }
    );
    for (const group of groups)
      group.items = [...group.items].sort(
        (a, b) =>
          Number(!!getLayerPlugin(a.layer)?.manifest.experimental) -
          Number(!!getLayerPlugin(b.layer)?.manifest.experimental)
      );
    const unique = [...new Map(groups.flatMap((g) => g.items).map((i) => [i.id, i])).values()];
    return { groups, unique };
  }, [version, statistics.catalog]);

  const scopedGroups = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (view === "all" && !query && group.id === "mine") return false;
      if (view === "mine" && group.id !== "mine") return false;
      if (view === "favorites" && !favorites.includes(item.id)) return false;
      if (view === "active" && !catalogItemState(item, layers).selected) return false;
      if (
        availableHere &&
        (reasonFor(item) || zoom < (getLayerPlugin(item.layer)?.minQueryZoom ?? 0))
      )
        return false;
      return true;
    })
  }));

  // The active list follows the order the user built it in: a layer added later sits lower, and
  // toggling one off and on again does not move it (§2.2). `activeLayers` keeps insertion order,
  // so its key order is that history; ties within one layer fall back to catalogue order.
  const active = useMemo(() => {
    const layerOrder = new Map(Object.keys(layers).map((id, index) => [id, index]));
    const catalogIndex = new Map(unique.map((it, index) => [it.id, index]));
    return unique
      .filter((i) => catalogItemState(i, layers).selected)
      .sort(
        (a, b) =>
          (layerOrder.get(a.layer) ?? 1e9) - (layerOrder.get(b.layer) ?? 1e9) ||
          (catalogIndex.get(a.id) ?? 0) - (catalogIndex.get(b.id) ?? 0)
      );
  }, [unique, layers]);

  const row = (item: CatalogItem, instance: string) => {
    const state = catalogItemState(item, layers);
    const plugin = getLayerPlugin(item.layer);
    const key = `${instance}-${item.id}`;
    const name = item.layer.startsWith("theme-") ? item.cs : st(item.cs, item.en);
    const unavailable = reasonFor(item);
    const opened = settings === key;
    return (
      <div
        key={key}
        className="catalog-item"
        data-selected={state.selected || undefined}
        data-testid={`catalog-${key}`}
      >
        <div className="catalog-row">
          <LayerActivityBadge id={item.layer} enabled={state.enabled}>
            <Icon
              name={
                item.icon ??
                (item.layer === "osm-poi"
                  ? poiCategoryIcon(item.values?.[0] ?? "")
                  : plugin
                    ? layerIcon(item.layer, plugin.manifest.category)
                    : "layers")
              }
              size={20}
            />
          </LayerActivityBadge>
          <span className="catalog-name">
            {name}
            <LayerStatus id={item.layer} enabled={state.enabled} />
            {unavailable && <small>{unavailable}</small>}
            {state.selected && !state.enabled && <small>{st("Pozastaveno", "Paused")}</small>}
          </span>
          <IconButton
            icon={favorites.includes(item.id) ? "star" : "star_border"}
            size="sm"
            label={`${st("Oblíbené", "Favorite")}: ${name}`}
            active={favorites.includes(item.id)}
            onClick={() => toggleFavorite(item.id)}
          />
          <IconButton
            icon="tune"
            size="sm"
            label={`${st("Nastavení", "Settings")}: ${name}`}
            active={opened}
            onClick={() => setSettings(opened ? null : key)}
            aria-expanded={opened}
            testId={`catalog-settings-btn-${key}`}
          />
          <Switch
            checked={state.enabled}
            disabled={!!unavailable && !state.enabled}
            label={name}
            testId={`${instance}-switch-${item.id}`}
            onChange={(next) => change(item, next)}
          />
          {instance === "active" && (
            <IconButton
              icon="close"
              size="sm"
              label={`${st("Odebrat", "Remove")}: ${name}`}
              onClick={() => change(item, false, true)}
              testId={`catalog-remove-${key}`}
            />
          )}
        </div>
        {opened && (
          <div
            className="catalog-settings"
            id={`settings-${key}`}
            tabIndex={-1}
            data-testid={`settings-${key}`}
          >
            {item.layer.startsWith("theme-") ? (
              <Button onClick={() => showStatistics(true)}>
                {st("Detail statistiky a zdrojů", "Statistic and sources")}
              </Button>
            ) : isWeatherLayerId(item.layer) ? (
              <WeatherLayerSettings layerId={item.layer} />
            ) : plugin ? (
              <PoiLayerRow plugin={plugin} settingsOnly skipFacet={item.facet} />
            ) : (
              <p>
                {st(
                  "Tato služba není v této instalaci připravena.",
                  "This service is not configured in this installation."
                )}
              </p>
            )}
            {plugin && (
              <details>
                <summary>
                  {st("Pokrytí, aktuálnost a licence", "Coverage, freshness and licence")}
                </summary>
                {(() => {
                  const e = catalogEvidence(
                    item.layer,
                    capabilities,
                    item.facet ? { [item.facet]: item.values } : undefined
                  );
                  return (
                    <dl>
                      <dt>{st("Zdroj", "Source")}</dt>
                      <dd>{e.source}</dd>
                      <dt>{st("Zobrazení", "Geometry")}</dt>
                      <dd>{e.geometry}</dd>
                      <dt>{st("Pokrytí", "Coverage")}</dt>
                      <dd>{e.coverage}</dd>
                      <dt>{st("Časová platnost", "Time period")}</dt>
                      <dd>{e.period}</dd>
                      <dt>{st("Obnova", "Refresh")}</dt>
                      <dd>{e.refresh}</dd>
                      <dt>{st("Licence", "Licence")}</dt>
                      <dd>{e.license}</dd>
                    </dl>
                  );
                })()}
              </details>
            )}
            {item.values && item.values.length > 1 && (
              <div>
                {item.values.map((value) => (
                  <label className="catalog-source" key={value}>
                    {value}
                    <Switch
                      label={value}
                      checked={
                        Array.isArray(layers[item.layer]?.filters[item.facet!]) &&
                        (layers[item.layer]!.filters[item.facet!] as string[]).includes(value)
                      }
                      onChange={(next) => change({ ...item, values: [value] }, next)}
                    />
                  </label>
                ))}
              </div>
            )}
            {item.id === "cyclosm" &&
              ["cycling", "mtb"].map((value) => (
                <label className="catalog-source" key={value}>
                  {value === "cycling" ? st("Značené cyklotrasy", "Marked cycling routes") : "MTB"}
                  <Switch
                    label={value}
                    checked={
                      catalogItemState(
                        {
                          id: value,
                          layer: "waymarked-trails",
                          cs: value,
                          en: value,
                          facet: "activity",
                          values: [value]
                        },
                        layers
                      ).enabled
                    }
                    onChange={(next) =>
                      change(
                        {
                          id: value,
                          layer: "waymarked-trails",
                          cs: value,
                          en: value,
                          facet: "activity",
                          values: [value]
                        },
                        next
                      )
                    }
                  />
                </label>
              ))}
            {item.related?.map((ref) => {
              // A plain string names a whole layer; the object form names one facet of a shared
              // layer, so several rows can draw from one tile source without a second download (§2.4).
              if (typeof ref !== "string" && ref.facet) {
                const label = st(ref.cs ?? ref.layer, ref.en ?? ref.layer);
                const sub: CatalogItem = {
                  id: `${item.id}-${ref.layer}-${ref.values?.join("-")}`,
                  layer: ref.layer,
                  facet: ref.facet,
                  values: ref.values,
                  cs: label,
                  en: label
                };
                const subState = catalogItemState(sub, layers);
                return (
                  <label className="catalog-source" key={sub.id}>
                    {label}
                    <Switch
                      label={label}
                      disabled={!!reasonFor(sub) && !subState.enabled}
                      checked={subState.enabled}
                      onChange={(next) => change(sub, next)}
                    />
                  </label>
                );
              }
              const id = relatedLayerId(ref);
              const relatedPlugin = getLayerPlugin(id);
              return relatedPlugin ? (
                <div key={id}>
                  <label className="catalog-source">
                    {relatedPlugin.manifest.name}
                    <Switch
                      label={relatedPlugin.manifest.name}
                      checked={!!layers[id]?.visible}
                      disabled={!!layerUnavailableReason(id, capabilities) && !layers[id]?.visible}
                      onChange={(next) => change({ id, layer: id, cs: id, en: id }, next)}
                    />
                  </label>
                  {layers[id]?.visible && <PoiLayerRow plugin={relatedPlugin} settingsOnly />}
                </div>
              ) : null;
            })}
          </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    const reveal = () => {
      const id = consumeLayerSettingsRequest();
      if (!id) return;
      const group = groups.find((group) => group.items.some((item) => item.id === id));
      if (!group) return;
      setView("all");
      setQuery("");
      setAvailableHere(false);
      setOpen((previous) => [...new Set([...previous, group.id])]);
      setSettings(`${group.id}-${id}`);
      // Subgroups also read this selection when they mount.
      setRevealItem({ id });
    };
    const off = on("layer-settings-request", reveal);
    reveal();
    return off;
  }, [groups]);
  useEffect(() => {
    if (!settings) return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(`settings-${settings}`);
      element?.scrollIntoView({ block: "nearest" });
      element?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [settings, revealItem]);

  const applyPreset = (p: (typeof presets)[number]) => {
    store.applyPreset(p);
    if ("openStatistics" in p && p.openStatistics) showStatistics(true);
  };

  // A query turns the catalogue into one flat, ranked list with the group as a caption. Expanding
  // sixteen accordion sections to answer one search was the slowest thing in this panel.
  const results = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    return scopedGroups.flatMap((group) =>
      group.items
        .filter((item) => itemSearchText(item, group).includes(q))
        .map((item) => ({ group, item }))
    );
  }, [query, scopedGroups]);

  return (
    <div className="unified-layers" data-testid="overflow-menu">
      <div className="catalog-preset">
        <Icon name="public" size={24} />
        <Select
          label={st("Preset", "Preset")}
          hideLabel
          testId="preset"
          placeholder="Custom"
          value={presetId ?? "custom"}
          onChange={(next) => {
            const p = presets.find((candidate) => candidate.id === next);
            if (p) applyPreset(p);
          }}
          options={[
            { value: "custom", label: "Custom" },
            ...presets.map((p) => ({ value: p.id, label: p.name }))
          ]}
        />
        <Button
          size="sm"
          variant="text"
          disabled={!presetId}
          onClick={() => store.resetPreset()}
          testId="preset-clear"
        >
          {st("Zrušit", "Clear")}
        </Button>
        <Button
          size="sm"
          variant="text"
          disabled={!!presetId}
          onClick={() => setSave(true)}
          testId="save-preset-open"
        >
          {st("Uložit", "Save")}
        </Button>
      </div>
      <SavePresetDialog open={save} onOpenChange={setSave} />

      <div className="catalog-controls">
        <SearchField
          label={st("Hledat vrstvy", "Search layers")}
          placeholder={st("Hledat vrstvy…", "Search layers…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          testId="layers-search"
        />
        <IconButton
          icon="public"
          size="sm"
          label={st("Zdroje a aktuálnost", "Sources and freshness")}
          active={sources}
          aria-expanded={sources}
          onClick={() => setSources((v) => !v)}
          testId="layers-sources"
        />
      </div>
      {sources && <WorldSection />}

      <div className="catalog-views" role="group" aria-label={st("Zobrazení vrstev", "Layer view")}>
        {(
          [
            ["all", "Vše", "All"],
            ["active", "Aktivní", "Active"],
            ["favorites", "Oblíbené", "Favorites"],
            ["mine", "Moje", "Mine"]
          ] as const
        ).map(([id, cs, en]) => (
          <Button
            key={id}
            size="sm"
            variant={view === id ? "tonal" : "text"}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            {st(cs, en)}
            {id === "active" ? ` (${active.length})` : ""}
          </Button>
        ))}
      </div>
      <div className="catalog-source">
        <span>{st("Dostupné při tomto přiblížení", "Available at this zoom")}</span>
        <Switch
          checked={availableHere}
          onChange={setAvailableHere}
          label={st("Dostupné při tomto přiblížení", "Available at this zoom")}
        />
      </div>
      {view === "all" && !query && active.length > 0 && (
        <section className="catalog-group">
          <button
            className="catalog-group-toggle"
            aria-expanded={activeOpen}
            onClick={() => setActiveOpen((v) => !v)}
          >
            {active.filter((i) => catalogItemState(i, layers).enabled).length}{" "}
            {st("zapnutých", "on")} · {active.length} {st("vybraných", "selected")}
            <Icon name={activeOpen ? "expand_less" : "expand_more"} size={16} />
          </button>
          {activeOpen && (
            <div data-testid="active-layer-list">{active.map((i) => row(i, "active"))}</div>
          )}
        </section>
      )}
      {query ? (
        <div className="catalog-results" data-testid="layers-results">
          {!results.length && (
            <EmptyState
              icon="search"
              title={st(`Nic jsme nenašli pro „${query}“`, `No layers match “${query}”`)}
              actionLabel={st("Hledání vymazat", "Clear search")}
              onAction={() => setQuery("")}
            />
          )}
          {results.map(({ group, item }) => (
            <div key={`${group.id}-${item.id}`} className="catalog-result">
              <span className="catalog-result-group">{st(group.cs, group.en)}</span>
              {row(item, group.id)}
            </div>
          ))}
        </div>
      ) : (
        scopedGroups
          .filter((g) => g.items.length)
          .map((group) => {
            const expanded = view !== "all" || open.includes(group.id);
            return (
              <section key={group.id} className="catalog-group" data-open={expanded || undefined}>
                <button
                  className="catalog-group-toggle"
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpen((v) =>
                      v.includes(group.id) ? v.filter((id) => id !== group.id) : [...v, group.id]
                    )
                  }
                >
                  <span className="catalog-group-title">{st(group.cs, group.en)}</span>
                  <span className="catalog-group-count">{group.items.length}</span>
                  <Icon name={expanded ? "expand_less" : "expand_more"} size={16} />
                </button>
                {expanded && group.id === "czech-land" ? (
                  <CzechSubgroups
                    revealItem={revealItem}
                    items={group.items}
                    layers={layers}
                    reasonFor={reasonFor}
                    change={change}
                    renderRow={(item) => row(item, view === "active" ? "active" : group.id)}
                  />
                ) : (
                  expanded &&
                  group.items.map((item, index) => (
                    <Fragment key={item.id}>
                      {item.subgroup &&
                        group.items[index - 1]?.subgroup?.cs !== item.subgroup.cs && (
                          <h3 className="catalog-result-group">
                            {st(item.subgroup.cs, item.subgroup.en)}
                          </h3>
                        )}
                      {row(item, view === "active" ? "active" : group.id)}
                    </Fragment>
                  ))
                )}
              </section>
            );
          })
      )}
      {view === "active" && active.length > 0 && (
        <Button
          variant="text"
          size="sm"
          onClick={() => active.forEach((i) => change(i, false, true))}
        >
          {st("Odebrat vybrané vrstvy", "Remove selected layers")}
        </Button>
      )}
      {view !== "all" && !scopedGroups.some((g) => g.items.length) && (
        <p>
          {st("Zatím žádné vrstvy. Vyber je v přehledu Vše.", "No layers yet. Choose them in All.")}
        </p>
      )}
      {statistics.error && <p role="status">{statistics.error}</p>}

      <Button
        variant="text"
        icon="add"
        onClick={() => {
          store.setMode("personal");
          store.setSidebarOpen(true);
        }}
      >
        {st("Přidat vlastní vrstvu nebo zdroj", "Add your layer or source")}
      </Button>
    </div>
  );
}
