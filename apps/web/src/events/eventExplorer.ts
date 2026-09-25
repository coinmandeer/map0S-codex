import {
  distanceMeters,
  featureAnchor,
  type GeoFeature,
  type MapViewState
} from "@mapos/layer-sdk";
import { intlLocale } from "../i18n";

export interface EventExplorerItem {
  feature: GeoFeature;
  id: string;
  title: string;
  category: string;
  startsAt: string | null;
  status: string;
  venue: string | null;
  price: string;
  distanceM: number;
  officialUrl: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function eventStatusLabel(value: unknown): string {
  if (value === "cancelled") return "Zrušeno";
  if (value === "postponed") return "Odloženo";
  if (value === "rescheduled") return "Přesunuto";
  if (value === "completed") return "Proběhlo";
  if (value === "unknown") return "Stav neověřen";
  return "Naplánováno";
}

export function eventPriceLabel(properties: GeoFeature["properties"]): string {
  if (properties.free === true) return "Zdarma";

  const minimum = number(properties.priceFrom);
  const maximum = number(properties.priceTo);
  const currency = text(properties.currency) ?? "";
  if (minimum !== null && maximum !== null) {
    return minimum === maximum
      ? `${minimum.toLocaleString(intlLocale())} ${currency}`.trim()
      : `${minimum.toLocaleString(intlLocale())}–${maximum.toLocaleString(intlLocale())} ${currency}`.trim();
  }
  if (minimum !== null) return `od ${minimum.toLocaleString(intlLocale())} ${currency}`.trim();
  if (properties.free === false) return "Placené · cena neuvedena";
  return "Cena neuvedena";
}

export function buildEventExplorerItems(
  features: readonly GeoFeature[],
  view: Pick<MapViewState, "lng" | "lat">,
  maxDistanceKm: number | null
): EventExplorerItem[] {
  const maximumM = maxDistanceKm === null ? Number.POSITIVE_INFINITY : maxDistanceKm * 1_000;
  return features
    .flatMap((feature): EventExplorerItem[] => {
      const [lng, lat] = featureAnchor(feature);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
      const distanceM = distanceMeters(view, { lng, lat });
      if (distanceM > maximumM) return [];
      const startsAt = text(feature.properties.startsAt ?? feature.properties.occurredAt);
      return [
        {
          feature,
          id: String(feature.properties.id),
          title: text(feature.properties.name) ?? "Událost bez názvu",
          category: text(feature.properties.category) ?? "Událost",
          startsAt: startsAt && Number.isFinite(Date.parse(startsAt)) ? startsAt : null,
          status: eventStatusLabel(feature.properties.status),
          venue: text(feature.properties.venue),
          price: eventPriceLabel(feature.properties),
          distanceM,
          officialUrl: text(feature.properties.officialUrl)
        }
      ];
    })
    .sort(
      (left, right) =>
        (left.startsAt ? Date.parse(left.startsAt) : Number.POSITIVE_INFINITY) -
          (right.startsAt ? Date.parse(right.startsAt) : Number.POSITIVE_INFINITY) ||
        left.distanceM - right.distanceM ||
        left.title.localeCompare(right.title, intlLocale())
    );
}
