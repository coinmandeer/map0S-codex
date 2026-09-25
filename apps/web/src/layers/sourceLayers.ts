import { API_BASE, apiGet } from "../lib/api";
import { createPinsLayerHandle } from "./pinsLayer";
import type { FeatureCollection } from "@mapos/layer-sdk";
import type { LayerManifestV2 } from "@mapos/layer-sdk";
import { cachedTileTemplate } from "../map/tileCache";
import { safeBrowserErrorFields } from "../lib/safeError";
import { allLayerPlugins, getLayerPlugin, registerLayerV2, unregisterLayer } from "./registry";
import { createTileLayer } from "./tileLayer";
import { createVectorTileLayer } from "./vectorTileLayer";

/**
 * Layers that exist because somebody pasted a URL.
 *
 * Every other layer in the app is a module: its manifest and its renderer are written together
 * and registered at startup. These are the opposite — the manifest was built by an adapter on
 * the server, stored, and arrives with the user's layer list, so registration happens whenever
 * that list loads and has to be idempotent and reversible.
 *
 * Raster/vector tiles use the shared tile cache. FeatureServer geometry is fetched through
 * the authenticated source endpoint and committed by the engine after its stale-response guard.
 */
export interface SourceBackedLayer {
  id: string;
  name: string;
  color: string;
  sourceManifest?: LayerManifestV2 | null;
}

/** Prefixed so a stored manifest's id can never collide with a built-in layer's, whatever the
 *  server minted. A hyphen, not a colon: layer ids are matched against
 *  `^[a-z0-9][a-z0-9._-]{1,99}$`, and a colon fails the manifest schema. */
const PREFIX = "source-";
const registeredInputs = new WeakMap<object, string>();

/**
 * The registry id for a user layer's id.
 *
 * Layer ids are matched against `^[a-z0-9][a-z0-9._-]{1,99}$`, and a user layer's id is not:
 * Postgres mints a lowercase UUID, but the offline server mints a nanoid, which is
 * case-sensitive. Lowercasing alone would map two distinct nanoids onto one layer, so a short
 * hash of the original id is appended and the mapping stays one-to-one.
 */
export function sourceLayerId(layerId: string): string {
  const slug = layerId.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `${PREFIX}${slug}-${hash(layerId)}`;
}

/** FNV-1a, for a stable short suffix. Not a security boundary — it only has to separate two ids
 *  that differ in case. */
function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(36);
}

/**
 * Brings the registry in line with the user's layers: registers what is new, drops what is gone.
 *
 * Returns added, updated and removed ids, so a caller can tell whether the layer catalogue changed and
 * the drawer needs to re-render.
 */
export function syncSourceLayers(layers: readonly SourceBackedLayer[]): string[] {
  const wanted = new Map(
    layers
      .filter((layer): layer is SourceBackedLayer & { sourceManifest: LayerManifestV2 } =>
        Boolean(layer.sourceManifest)
      )
      .map((layer) => [sourceLayerId(layer.id), layer])
  );

  // What is registered is read back from the registry rather than tracked in a set here. The
  // prefix makes the namespace exclusively this module's, so the registry is the one source of
  // truth and there is no second copy to drift out of step with it.
  const changed: string[] = [];
  for (const id of registeredSourceLayerIds()) {
    if (!wanted.has(id)) {
      unregisterLayer(id);
      changed.push(id);
    }
  }

  for (const [id, layer] of wanted) {
    const previous = getLayerPlugin(id);
    const signature = JSON.stringify([layer.name, layer.color, layer.sourceManifest]);
    if (previous && registeredInputs.get(previous) === signature) continue;
    try {
      if (!registerSourceLayer(id, layer, Boolean(previous))) continue;
    } catch (error) {
      // A manifest that fails validation was written by an older version of MapOS, or by an
      // adapter that has since changed. Skipping it loses one layer; throwing would lose the
      // whole list, including the pin layers that have nothing to do with it.
      console.warn(
        `Vrstvu „${layer.name}" nejde načíst z uloženého zdroje.`,
        safeBrowserErrorFields(error)
      );
      continue;
    }
    const registered = getLayerPlugin(id);
    if (registered) registeredInputs.set(registered, signature);
    changed.push(id);
  }
  return changed;
}

function registeredSourceLayerIds(): string[] {
  return allLayerPlugins()
    .map((plugin) => plugin.manifest.id)
    .filter((id) => id.startsWith(PREFIX));
}

function registerSourceLayer(
  id: string,
  layer: SourceBackedLayer & { sourceManifest: LayerManifestV2 },
  replace = false
): boolean {
  const manifest = layer.sourceManifest;
  if (manifest.source.type === "server-adapter" && manifest.source.adapterId === "arcgis") {
    registerLayerV2(
      {
        manifest: { ...manifest, id, name: layer.name || manifest.name, category: "user" },
        create: (ctx) =>
          createPinsLayerHandle(
            ctx.map,
            API_BASE,
            ctx.layerId,
            layer.color,
            async (bbox, _filters, signal) => {
              const data = await apiGet<FeatureCollection>(
                `/v2/sources/layers/${encodeURIComponent(layer.id)}/features`,
                { auth: true, signal, query: { bbox: bbox.join(",") } }
              );
              signal?.throwIfAborted();
              return {
                ...data,
                features: data.features.map((feature) => ({
                  ...feature,
                  properties: {
                    ...feature.properties,
                    id: `${layer.id}:${feature.properties.id}`,
                    layerId: ctx.layerId
                  }
                }))
              };
            }
          )
      },
      { replace }
    );
    return true;
  }
  const template = manifest.source.tileTemplate;
  if (!template) return false;

  const raster = manifest.source.type === "raster-tiles";
  const vector = manifest.source.type === "vector-tiles";
  if (!raster && !vector) return false;

  const tiles = [cachedTileTemplate(template)];
  const attribution = manifest.attribution
    ?.map((entry) => (entry.url ? `<a href="${entry.url}">${entry.label}</a>` : entry.label))
    .join(", ");

  registerLayerV2(
    {
      manifest: {
        ...manifest,
        id,
        // The user's own name and colour win over whatever the service called itself: they are
        // what the layer is listed under everywhere else in the app.
        name: layer.name || manifest.name,
        // Pasted sources belong to the person who pasted them, not to a curated section.
        category: "user"
      },
      create: (ctx) =>
        raster
          ? createTileLayer(ctx.map, ctx.layerId, {
              tiles,
              ...(manifest.source.adapterId === "wms" &&
              manifest.filters?.some((facet) => facet.id === "wmsTime")
                ? {
                    tilesForFilters: (filters: Record<string, unknown>) => [
                      cachedTileTemplate(wmsTimeTemplate(manifest, filters.wmsTime))
                    ]
                  }
                : {}),
              ...(manifest.queryPolicy?.minZoom !== undefined
                ? { minzoom: manifest.queryPolicy.minZoom }
                : {}),
              ...(manifest.queryPolicy?.maxZoom !== undefined
                ? { maxzoom: manifest.queryPolicy.maxZoom }
                : {}),
              ...(attribution ? { attribution } : {})
            })
          : createVectorTileLayer(ctx.map, ctx.layerId, {
              tiles,
              sourceLayer: firstSourceLayer(manifest),
              ...(manifest.queryPolicy?.minZoom !== undefined
                ? { minzoom: manifest.queryPolicy.minZoom }
                : {}),
              ...(manifest.queryPolicy?.maxZoom !== undefined
                ? { maxzoom: manifest.queryPolicy.maxZoom }
                : {}),
              ...(attribution ? { attribution } : {}),
              // Nobody styled these polygons, so they are drawn in the layer's own colour rather
              // than in a palette guessed from property names.
              fillColor: layer.color,
              outlineColor: layer.color
            })
    },
    { replace }
  );
  return true;
}

/** A vector archive can hold several named layers; the renderer draws the first chosen one.
 *  Drawing all of them in one colour would stack unrelated geometry into a single smear. */
function firstSourceLayer(manifest: LayerManifestV2): string {
  const layers = manifest.renderer.style?.["sourceLayers"];
  if (Array.isArray(layers) && typeof layers[0] === "string") return layers[0];
  return "default";
}

/** Only advertised options can affect the URL; keep MapLibre's bbox placeholder unescaped. */
export function wmsTimeTemplate(manifest: LayerManifestV2, value: unknown): string {
  const template = manifest.source.tileTemplate!;
  const facet = manifest.filters?.find(
    (item) => item.id === "wmsTime" && item.providerField === "TIME"
  );
  const selected = facet?.options?.find((option) => option.id === value)?.id ?? facet?.default;
  if (typeof selected !== "string" || !facet?.options?.some((option) => option.id === selected))
    return template;
  const url = new URL(template);
  for (const key of [...url.searchParams.keys()])
    if (key.toLowerCase() === "time") url.searchParams.delete(key);
  url.searchParams.set("time", selected);
  return url.href.replaceAll("%7Bbbox-epsg-3857%7D", "{bbox-epsg-3857}");
}
