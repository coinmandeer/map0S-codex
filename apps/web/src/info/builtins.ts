/** Registers the first-party info panels.
 *
 *  Import for the side effect — `apps/web/src/info/index.ts` guarantees it runs before anything
 *  reads the registry. */

import {
  FOURSQUARE_RIGHTS,
  GEOCACHING_RIGHTS,
  GOOGLE_MAPS_RIGHTS,
  KOMOOT_RIGHTS,
  MACROSTRAT_RIGHTS,
  MAPILLARY_RIGHTS,
  OPEN_METEO_RIGHTS,
  OPENSTREETMAP_RIGHTS,
  WIKIDATA_RIGHTS,
  WIKIPEDIA_RIGHTS,
  WINDY_RIGHTS
} from "../product/browserExternalSources";
import { registerInfoPanel } from "./registry";
import { BriefPanel } from "./panels/BriefPanel";
import { GeologyPanel } from "./panels/GeologyPanel";
import { OverviewPanel } from "./panels/OverviewPanel";
import { hasPracticalFacts, PracticalPanel } from "./panels/PracticalPanel";
import { WikipediaPanel } from "./panels/WikipediaPanel";
import { WikidataPanel } from "./panels/WikidataPanel";
import { WeatherPanel } from "./panels/WeatherPanel";
import { FoursquarePanel } from "./panels/FoursquarePanel";
import { ExternalLinksPanel, MapillaryPanel, OsmPanel, WindyPanel } from "./panels/embedPanels";

registerInfoPanel({
  id: "prehled",
  label: "Přehled",
  icon: "📋",
  kind: "api",
  order: 0,
  surface: "overview",
  contentOwner: "canonical",
  appliesTo: () => true,
  attribution: "MapOS",
  render: OverviewPanel
});

registerInfoPanel({
  id: "prakticke",
  label: "Praktické",
  icon: "ℹ️",
  kind: "api",
  order: 2,
  surface: "practical",
  contentOwner: "canonical",
  appliesTo: ({ place }) => hasPracticalFacts(place),
  attribution: "MapOS + zdroje místa",
  render: PracticalPanel
});

registerInfoPanel({
  id: "souhrn",
  label: "Co tu je",
  icon: "✨",
  kind: "api",
  order: 5,
  surface: "more",
  contentOwner: "canonical",
  // Every place has coordinates, and the brief is built from what is around them — so it has
  // something to say even for a pin whose own name is all we know about it.
  appliesTo: ({ place }) => Number.isFinite(place.lng) && Number.isFinite(place.lat),
  attribution: "OpenStreetMap, Wikipedia, CML",
  render: BriefPanel
});

registerInfoPanel({
  id: "wikipedia",
  label: "Wikipedia",
  icon: "📖",
  kind: "api",
  order: 10,
  surface: "more",
  contentOwner: "provider",
  sourceId: "wikipedia",
  sourceRights: [WIKIPEDIA_RIGHTS],
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
  surface: "more",
  contentOwner: "provider",
  sourceId: "wikidata",
  sourceRights: [WIKIDATA_RIGHTS],
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
  surface: "more",
  contentOwner: "provider",
  sourceId: "open-meteo",
  sourceRights: [OPEN_METEO_RIGHTS],
  appliesTo: () => true,
  attribution: "Open-Meteo (CC BY 4.0)",
  render: WeatherPanel
});

registerInfoPanel({
  id: "geologie",
  label: "Pod nohama",
  icon: "🪨",
  kind: "api",
  order: 34,
  surface: "more",
  contentOwner: "provider",
  sourceId: "macrostrat",
  sourceRights: [MACROSTRAT_RIGHTS],
  appliesTo: ({ place }) => Number.isFinite(place.lng) && Number.isFinite(place.lat),
  attribution: "Macrostrat (CC BY 4.0)",
  render: GeologyPanel
});

registerInfoPanel({
  id: "mapy-okoli",
  label: "Okolí",
  icon: "🗺️",
  kind: "iframe",
  order: 35,
  surface: "more",
  contentOwner: "provider",
  sourceId: "osm",
  sourceRights: [OPENSTREETMAP_RIGHTS],
  appliesTo: () => true,
  attribution: "© OpenStreetMap přispěvatelé (ODbL)",
  render: OsmPanel
});

registerInfoPanel({
  id: "mapillary",
  label: "Ulice",
  icon: "📷",
  kind: "iframe",
  order: 36,
  surface: "more",
  contentOwner: "provider",
  sourceId: "mapillary",
  sourceRights: [MAPILLARY_RIGHTS],
  appliesTo: () => true,
  attribution: "Mapillary (CC BY-SA)",
  render: MapillaryPanel
});

registerInfoPanel({
  id: "windy",
  label: "Windy",
  icon: "🌀",
  kind: "iframe",
  order: 37,
  surface: "more",
  contentOwner: "provider",
  sourceId: "windy",
  sourceRights: [WINDY_RIGHTS],
  appliesTo: () => true,
  attribution: "Windy.com",
  render: WindyPanel
});

registerInfoPanel({
  id: "foursquare",
  label: "Recenze",
  icon: "⭐",
  kind: "api",
  order: 40,
  surface: "social",
  contentOwner: "provider",
  sourceId: "fsq",
  sourceRights: [FOURSQUARE_RIGHTS],
  appliesTo: ({ place, refs }) => Boolean(place.fsqId ?? refs.fsq),
  attribution: "Foursquare",
  render: FoursquarePanel
});

registerInfoPanel({
  id: "odkazy",
  label: "Odkazy",
  icon: "↗",
  kind: "link",
  order: 90,
  surface: "more",
  contentOwner: "provider",
  sourceRights: [GOOGLE_MAPS_RIGHTS, GEOCACHING_RIGHTS, KOMOOT_RIGHTS, OPENSTREETMAP_RIGHTS],
  appliesTo: () => true,
  attribution: "Externí služby",
  render: ExternalLinksPanel
});
