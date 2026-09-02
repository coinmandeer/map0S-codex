import type { FeatureCollection, GeoFeature } from "@mapos/layer-sdk";
import { sourceRef } from "@mapos/layer-sdk";

/** A community pin can arrive through the fused POI catalogue and through the owner's
 * `user-layers` feed at the same time. The native user-pin id is the ownership key shared by
 * both representations. */
export function userPinRef(feature: GeoFeature): string | null {
  const properties = feature.properties;
  if (properties.layerId === "user-layers") return String(properties.id);

  const fromProvenance = sourceRef(properties.sourceRefs, "user");
  if (fromProvenance) return fromProvenance;

  const id = String(properties.id ?? "");
  return id.startsWith("user:") ? id.slice("user:".length) || null : null;
}

export function ownedUserPinRefs(data: FeatureCollection | undefined): Set<string> {
  return new Set(
    (data?.features ?? []).map(userPinRef).filter((ref): ref is string => Boolean(ref))
  );
}

/** `user-layers` owns the rendered copy while it is active because it carries editing metadata,
 * colour and the actual layer id. Fused layers keep every other public community pin, and regain
 * the overlapping pin as soon as `user-layers` is switched off. */
export function applyFeatureOwnership(
  layerId: string,
  data: FeatureCollection,
  ownedRefs: ReadonlySet<string>
): FeatureCollection {
  if (layerId === "user-layers" || ownedRefs.size === 0) return data;
  const features = data.features.filter((feature) => {
    const ref = userPinRef(feature);
    return !ref || !ownedRefs.has(ref);
  });
  return features.length === data.features.length ? data : { ...data, features };
}
