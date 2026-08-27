/** Registers the first-party info panels.
 *
 *  Import for the side effect — `apps/web/src/info/index.ts` guarantees it runs before anything
 *  reads the registry. */

import { registerInfoPanel } from "./registry";
import { OverviewPanel } from "./panels/OverviewPanel";
import { WikipediaPanel } from "./panels/WikipediaPanel";
import { WikidataPanel } from "./panels/WikidataPanel";
import { WeatherPanel } from "./panels/WeatherPanel";
import { FoursquarePanel } from "./panels/FoursquarePanel";

registerInfoPanel({
  id: "prehled",
  label: "Přehled",
  icon: "📋",
  kind: "api",
  order: 0,
  appliesTo: () => true,
  attribution: "MapOS",
  render: OverviewPanel
});

registerInfoPanel({
  id: "wikipedia",
  label: "Wikipedia",
  icon: "📖",
  kind: "api",
  order: 10,
  // A QID guarantees an article exists somewhere; a name only makes one plausible, which is
  // still worth a tab because the lookup degrades to an empty state rather than an error.
  appliesTo: ({ place }) => Boolean(place.wikidata || place.name),
  attribution: "Wikipedia (CC BY-SA)",
  render: WikipediaPanel
});

registerInfoPanel({
  id: "wikidata",
  label: "Fakta",
  icon: "🔗",
  kind: "api",
  order: 20,
  appliesTo: ({ place, refs }) => Boolean(place.wikidata ?? refs.wikidata),
  attribution: "Wikidata (CC0)",
  render: WikidataPanel
});

registerInfoPanel({
  id: "pocasi",
  label: "Počasí",
  icon: "🌤️",
  kind: "api",
  order: 30,
  appliesTo: () => true,
  attribution: "Open-Meteo (CC BY 4.0)",
  render: WeatherPanel
});

registerInfoPanel({
  id: "foursquare",
  label: "Recenze",
  icon: "⭐",
  kind: "api",
  order: 40,
  appliesTo: ({ place, refs }) => Boolean(place.fsqId ?? refs.fsq),
  attribution: "Foursquare",
  render: FoursquarePanel
});
