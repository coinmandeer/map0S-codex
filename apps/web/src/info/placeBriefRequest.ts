/**
 * What the AI summary is asked about.
 *
 * A brief built from coordinates alone describes a street corner: two pins two hundred metres
 * apart — a bakery and a bike repair stand — used to come back with the same paragraph about the
 * neighbourhood. So a click on a pin sends the pin: which layer it belongs to and the fields that
 * layer publishes about it. A click on empty map keeps sending just the location, because there
 * is nothing else to send.
 *
 * (The file is not called `briefQuery` because a dev-server module path containing `info/brief`
 * is caught by the `**\/info/brief**` route stubs in the e2e suite and served JSON.)
 *
 * A layer can also opt out entirely (`detail.aiEnrichment: "disabled"`), which is how the saved
 * places layer and the photo layers avoid generating prose about a photo of a wall.
 */

import type { GeoFeature, Place } from "@mapos/layer-sdk";
import { detailFieldsFromFeature } from "./detailModel";
import { getLayerManifestV2 } from "../layers/registry";

/** Fields worth stating about a pin when its layer declares no `fieldOrder` of its own. */
const FALLBACK_FACT_KEYS = [
  "opening_hours",
  "phone",
  "website",
  "operator",
  "cuisine",
  "taxon",
  "species",
  "capacity",
  "power",
  "maxPowerKw",
  "connectorTypes",
  "rating",
  "fee",
  "access",
  "ele"
] as const;

const MAX_FACTS = 12;

export interface BriefRequest {
  /** False when the layer declares `aiEnrichment: "disabled"` — no request should be made. */
  enabled: boolean;
  /** Whether the summary may be generated without an explicit click. */
  auto: boolean;
  query: Record<string, string | undefined>;
}

function factText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    const parts = value.map(factText).filter((part): part is string => part !== null);
    return parts.length ? parts.slice(0, 6).join(", ") : null;
  }
  return null;
}

/** The wire format is `label=value` pairs joined by `|`, so both separators are stripped from
 *  the payload rather than escaped: a field with a pipe in it is not worth a parser. */
function encodeFacts(facts: readonly { label: string; value: string }[]): string | undefined {
  const encoded = facts
    .slice(0, MAX_FACTS)
    .map(
      ({ label, value }) =>
        `${label.replace(/[|=]/gu, " ").trim()}=${value.replace(/[|=]/gu, " ").trim().slice(0, 160)}`
    )
    .filter((pair) => pair.length > 1);
  return encoded.length ? encoded.join("|") : undefined;
}

function pinFacts(
  feature: GeoFeature,
  layerId: string | undefined
): { label: string; value: string }[] {
  const manifest = layerId ? getLayerManifestV2(layerId) : undefined;
  const fromManifest = detailFieldsFromFeature(feature, manifest).map((field) => ({
    label: field.label,
    value: String(field.value)
  }));
  if (fromManifest.length) return fromManifest;

  return FALLBACK_FACT_KEYS.flatMap((key) => {
    const value = factText(feature.properties[key]);
    return value ? [{ label: key, value }] : [];
  });
}

/** The brief for a location the reader clicked on the map, with no pin under it. */
export function locationBriefRequest(place: Place): BriefRequest {
  return {
    enabled: true,
    auto: true,
    query: {
      lng: place.lng.toFixed(4),
      lat: place.lat.toFixed(4),
      name: place.name,
      category: place.category,
      qid: place.wikidata
    }
  };
}

/** The brief for one pin: its layer, its own fields, and permission to check the web. */
export function pinBriefRequest(input: {
  place: Place;
  layerId?: string;
  feature?: GeoFeature;
}): BriefRequest {
  const { place, layerId, feature } = input;
  if (!feature) return locationBriefRequest(place);

  const manifest = layerId ? getLayerManifestV2(layerId) : undefined;
  const enrichment = manifest?.detail?.aiEnrichment;
  const facts = pinFacts(feature, layerId);

  return {
    enabled: enrichment !== "disabled",
    auto: enrichment !== "on-demand",
    query: {
      ...locationBriefRequest(place).query,
      layerId: layerId,
      layerName: manifest?.name,
      facts: encodeFacts(facts),
      // A named pin is a thing the web may know something about; a bare coordinate is not, and a
      // search for one only spends a round trip.
      web: place.name ? "1" : undefined
    }
  };
}
