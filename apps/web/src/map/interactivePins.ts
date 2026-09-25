import type maplibregl from "maplibre-gl";
/** Renderers own registration; callers never infer provider IDs from layer-name punctuation. */
const registries = new WeakMap<maplibregl.Map, Map<string, string>>();
export function registerInteractivePins(map: maplibregl.Map, owner: string, ids: string[]) {
  let registry = registries.get(map);
  if (!registry) {
    registry = new Map();
    registries.set(map, registry);
  }
  for (const id of ids) registry.set(id, owner);
}
export function unregisterInteractivePins(map: maplibregl.Map, ids: string[]) {
  for (const id of ids) registries.get(map)?.delete(id);
}
export function interactivePinLayers(map: maplibregl.Map): string[] {
  return [...(registries.get(map)?.keys() ?? [])].filter((id) => Boolean(map.getLayer(id)));
}
export function interactivePinOwner(map: maplibregl.Map, id: string): string | undefined {
  return registries.get(map)?.get(id);
}
