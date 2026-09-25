import { API_BASE } from "../lib/api";
/** Shared photo URL resolution with an in-memory cache so place cards and pin detail
 * don't re-hit `/photos/resolve` when the user flips between nearby pins. */

const cache = new Map<string, Promise<string | null>>();
const warmed = new Set<string>();

export function resolvePhotoUrl(opts: {
  photo?: string | null;
  wikidata?: string | null;
}): Promise<string | null> {
  if (opts.photo) return Promise.resolve(opts.photo);
  if (!opts.wikidata) return Promise.resolve(null);
  const key = opts.wikidata;
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = fetch(`${API_BASE}/photos/resolve?wikidata=${encodeURIComponent(key)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data: { url?: string } | null) => data?.url ?? null)
    .catch(() => null);
  cache.set(key, promise);
  while (cache.size > 256) cache.delete(cache.keys().next().value!);
  return promise;
}

/** Fire-and-forget warm of photo URLs (and browser image decode) for the next/prev pins. */
export function preloadPlacePhotos(
  items: Array<{ photo?: string | null; wikidata?: string | null }>
) {
  for (const item of items) {
    const key = item.photo ?? (item.wikidata ? `wd:${item.wikidata}` : null);
    if (!key || warmed.has(key)) continue;
    warmed.add(key);
    while (warmed.size > 128) warmed.delete(warmed.values().next().value!);
    void resolvePhotoUrl(item).then((url) => {
      if (!url || typeof Image === "undefined") return;
      const img = new Image();
      img.decoding = "async";
      img.src = url;
    });
  }
}
