import {
  resolveWeatherVisualization,
  WEATHER_VISUALIZATIONS,
  weatherVisualizationFilters,
  type WeatherVisualizationId
} from "../../layers/weather/controls";
import { getMapStore } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { Icon, InfoTip, RadioGroup, Slider, Switch, type IconName } from "../kit";

const WEATHER_ICONS: Record<WeatherVisualizationId, IconName> = {
  radar: "radar",
  precipitation: "rainy",
  temperature: "thermostat",
  wind: "air",
  gusts: "storm",
  clouds: "cloud",
  pressure: "compress",
  humidity: "humidity_percentage"
};

export type WeatherChoice = WeatherVisualizationId | "off";

export function activeWeatherLabel(on: boolean, visualization: WeatherVisualizationId): string {
  if (!on) return "Vypnuto";
  return WEATHER_VISUALIZATIONS.find(({ id }) => id === visualization)?.label ?? "Zapnuto";
}

/** One weather quantity at a time (§4.7 ⑤).
 *
 *  Weather stopped being a mode of its own: it is a set of mutually exclusive overlays, and
 *  making them a radio group is what stops a radar image and a temperature field being drawn
 *  on top of each other, which was unreadable and cost two provider requests.
 */
export function WeatherSection() {
  const store = getMapStore();
  const active = useMapStoreSnapshot((s) => s.activeLayers);
  const weather = active.weather;
  const on = Boolean(weather?.visible);
  const visualization = resolveWeatherVisualization(weather?.filters ?? {});
  const opacity = weather?.opacity ?? 0.6;

  const select = (choice: WeatherChoice) => {
    if (choice === "off") {
      if (store.activeLayers.weather?.visible) store.toggleLayer("weather");
      store.showToast("Počasí vypnuto");
      return;
    }
    if (!store.activeLayers.weather?.visible) store.toggleLayer("weather");
    const current = store.activeLayers.weather?.filters ?? {};
    store.setLayerFilters("weather", weatherVisualizationFilters(current, choice));
    store.showToast(`${activeWeatherLabel(true, choice)} zapnuto`);
  };

  return (
    <div className="weather-section" data-testid="weather-radio-group">
      <RadioGroup<WeatherChoice>
        ariaLabel="Zobrazení počasí"
        value={on ? visualization : "off"}
        testId="weather-visualization"
        onChange={select}
        options={[
          { value: "off", label: <span className="weather-option">Vypnuto</span> },
          ...WEATHER_VISUALIZATIONS.map((option) => ({
            value: option.id as WeatherChoice,
            label: (
              <span className="weather-option">
                <Icon name={WEATHER_ICONS[option.id]} size={20} />
                {option.label}
                <span className="weather-unit">{option.unit}</span>
              </span>
            )
          }))
        ]}
      />
      {on && (
        <div className="weather-section-footer">
          <div className="weather-section-row">
            <span className="weather-section-label">Popisky hodnot při přiblížení</span>
            <Switch
              checked={weather?.filters?.valueLabels !== false}
              label="Popisky hodnot při přiblížení"
              testId="weather-value-labels"
              onChange={(next) =>
                store.setLayerFilters("weather", {
                  ...(store.activeLayers.weather?.filters ?? {}),
                  valueLabels: next
                })
              }
            />
          </div>
          <Slider
            label="Průhlednost"
            min={0.2}
            max={1}
            step={0.05}
            value={opacity}
            format={(value) => `${Math.round(value * 100)} %`}
            onChange={(next) => store.setLayerOpacity("weather", next)}
            testId="weather-opacity"
          />
          <InfoTip title="Odkud jsou data" testId="weather-sources-info">
            Srážkový radar dodává RainViewer, číselné veličiny Open-Meteo. Při přiblížení se plocha
            mění na hodnoty v sektorech, aby šlo číst konkrétní čísla.
          </InfoTip>
        </div>
      )}
    </div>
  );
}
