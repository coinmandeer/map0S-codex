import type { PlanDocumentV2, PlanTravelProfileV2 } from "@mapos/layer-sdk";

export type ExternalHandoffId = "google" | "mapy" | "osm";

export interface ExternalPlanHandoff {
  id: ExternalHandoffId;
  label: string;
  href: string;
  includedStops: number;
  totalStops: number;
  limitation: string | null;
}

const GOOGLE_MAX_STOPS = 5;
const MAPY_MAX_STOPS = 17;
const OSM_MAX_STOPS = 2;

function latLng(stop: PlanDocumentV2["stops"][number]): string {
  return `${stop.location.coordinates[1]},${stop.location.coordinates[0]}`;
}

function lngLat(stop: PlanDocumentV2["stops"][number]): string {
  return `${stop.location.coordinates[0]},${stop.location.coordinates[1]}`;
}

function limitation(includedStops: number, totalStops: number, detail: string): string | null {
  return totalStops > includedStops
    ? `Předá prvních ${includedStops} z ${totalStops} zastávek — ${detail}.`
    : null;
}

function googleTravelMode(profile: PlanTravelProfileV2): string {
  if (profile === "foot") return "walking";
  if (profile === "bike") return "bicycling";
  return "driving";
}

function mapyRouteType(document: PlanDocumentV2): string {
  const profile = document.routePolicy.profile;
  const preference = document.routePolicy.preference;
  if (profile === "foot") return preference === "adventure" ? "foot_hiking" : "foot_fast";
  if (profile === "bike") return preference === "adventure" ? "bike_mountain" : "bike_road";
  return preference === "short" ? "car_short" : "car_fast_traffic";
}

function osmEngine(profile: PlanTravelProfileV2): string {
  if (profile === "foot") return "fossgis_valhalla_foot";
  if (profile === "bike") return "fossgis_valhalla_bicycle";
  return "fossgis_osrm_car";
}

function googleHandoff(document: PlanDocumentV2): ExternalPlanHandoff {
  const stops = document.stops.slice(0, GOOGLE_MAX_STOPS);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", latLng(stops[0]!));
  url.searchParams.set("destination", latLng(stops.at(-1)!));
  url.searchParams.set("travelmode", googleTravelMode(document.routePolicy.profile));
  if (stops.length > 2) {
    url.searchParams.set("waypoints", stops.slice(1, -1).map(latLng).join("|"));
  }
  return {
    id: "google",
    label: "Google Maps",
    href: url.toString(),
    includedStops: stops.length,
    totalStops: document.stops.length,
    limitation: limitation(
      stops.length,
      document.stops.length,
      "mobilní Google Maps podporují nejvýše 3 průjezdní body"
    )
  };
}

function mapyHandoff(document: PlanDocumentV2): ExternalPlanHandoff {
  const stops = document.stops.slice(0, MAPY_MAX_STOPS);
  const url = new URL("https://mapy.com/fnc/v1/route");
  url.searchParams.set("start", lngLat(stops[0]!));
  url.searchParams.set("end", lngLat(stops.at(-1)!));
  url.searchParams.set("routeType", mapyRouteType(document));
  if (stops.length > 2) {
    url.searchParams.set("waypoints", stops.slice(1, -1).map(lngLat).join(";"));
  }
  return {
    id: "mapy",
    label: "Mapy.com",
    href: url.toString(),
    includedStops: stops.length,
    totalStops: document.stops.length,
    limitation: limitation(
      stops.length,
      document.stops.length,
      "Mapy.com podporují nejvýše 15 průjezdních bodů"
    )
  };
}

function osmHandoff(document: PlanDocumentV2): ExternalPlanHandoff {
  const stops = document.stops.slice(0, OSM_MAX_STOPS);
  const url = new URL("https://www.openstreetmap.org/directions");
  url.searchParams.set("engine", osmEngine(document.routePolicy.profile));
  url.searchParams.set("route", stops.map(latLng).join(";"));
  return {
    id: "osm",
    label: "OpenStreetMap",
    href: url.toString(),
    includedStops: stops.length,
    totalStops: document.stops.length,
    limitation: limitation(
      stops.length,
      document.stops.length,
      "webové plánování OpenStreetMap je A→B; otevře první úsek"
    )
  };
}

export function buildExternalPlanHandoffs(document: PlanDocumentV2): ExternalPlanHandoff[] {
  if (document.stops.length < 2) return [];
  return [googleHandoff(document), mapyHandoff(document), osmHandoff(document)];
}
