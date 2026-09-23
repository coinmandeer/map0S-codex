import {
  resolveWeatherModel,
  WEATHER_MODEL_IDS,
  weatherVisualizationOfLayerId
} from "../../layers/weather/controls";
import { maptilerVariable } from "../../layers/weather/maptiler";
import { t } from "../../i18n";
import { st } from "../../statistics/labels";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Slider, Switch } from "../kit";

/** Settings for one weather layer.
 *
 *  The forecast model applies only to the numeric fields (radar has a single provider), and the
 *  opacity/label controls are per layer now, so two weather layers can be tuned independently. */
export function WeatherLayerSettings({ layerId }: { layerId: string }) {
  const store = getMapStore();
  const layers = useMapStoreSnapshot((s) => s.activeLayers);
  const capabilities = useMapStoreSnapshot((s) => s.capabilities);
  const layer = layers[layerId];
  const filters = layer?.filters ?? {};
  const visualization = weatherVisualizationOfLayerId(layerId);
  const opacity = layer?.opacity ?? 0.6;
  const model = resolveWeatherModel(filters.model);
  // MapTiler's animated tiles are only offered when the deployment holds the key and the
  // variable exists upstream; otherwise the switch would promise data it cannot fetch.
  const canUseMaptiler =
    Boolean(capabilities?.maptiler) &&
    visualization !== null &&
    maptilerVariable(visualization) !== null;

  return (
    <div className="weather-section" data-testid={`weather-settings-${layerId}`}>
      <div className="weather-section-footer">
        {visualization && visualization !== "radar" && (
          <>
            <label className="weather-section-label">
              {t("weather.model")}
              <select
                data-testid={`weather-model-${layerId}`}
                value={model}
                onChange={(event) =>
                  store.setLayerFilters(layerId, {
                    ...filters,
                    model: resolveWeatherModel(event.target.value)
                  })
                }
              >
                {WEATHER_MODEL_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`weather.model.${id}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <p className="meta">
          {st(
            "Automaticky: dlaždice pro velké oblasti, lokální předpověď při přiblížení. Plynulé barvy jsou interpolované, ne další měření.",
            "Automatic: tiles for large areas, local forecast when zoomed in. Smooth colours are interpolated, not additional measurements."
          )}
        </p>
        {canUseMaptiler && (
          <label className="weather-section-label">
            {st("Zdroj zobrazení", "Display source")}
            <select
              value={String(filters.provider ?? "auto")}
              data-testid={`weather-provider-maptiler-${layerId}`}
              onChange={(event) =>
                store.setLayerFilters(layerId, {
                  ...filters,
                  provider: event.target.value === "auto" ? undefined : event.target.value
                })
              }
            >
              <option value="auto">{st("Automaticky", "Automatic")}</option>
              <option value="open-meteo">Open-Meteo</option>
              <option value="maptiler">MapTiler</option>
            </select>
          </label>
        )}
        <Slider
          label={t("weather.opacity")}
          min={0.2}
          max={1}
          step={0.05}
          value={opacity}
          format={(value) => `${Math.round(value * 100)} %`}
          onChange={(next) => store.setLayerOpacity(layerId, next)}
          testId={`weather-opacity-${layerId}`}
        />
        <details>
          <summary>{st("Model a zdroje dat", "Model and data sources")}</summary>
          <p className="weather-section-label">{t(`weather.modelInfo.${model}`)}</p>
          <p className="meta">{t("weather.sources.body")}</p>
        </details>
        <div className="weather-section-row">
          <span className="weather-section-label">{t("weather.valueLabels")}</span>
          <Switch
            checked={filters.valueLabels !== false}
            label={t("weather.valueLabels")}
            testId={`weather-value-labels-${layerId}`}
            onChange={(next) => store.setLayerFilters(layerId, { ...filters, valueLabels: next })}
          />
        </div>
      </div>
    </div>
  );
}
