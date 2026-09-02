import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { photoCache } from "../db/schema.js";
import { fetchJson } from "../utils/upstream.js";

const TTL_MS = 30 * 24 * 3600_000;

/** Resolves a Wikidata QID to a Wikimedia Commons thumbnail URL (P18 "image" claim),
 * caching both hits and misses so a place without a photo isn't re-queried on every card
 * render. */
export async function resolvePhoto(wikidataId: string): Promise<string | null> {
  const [cached] = await db
    .select()
    .from(photoCache)
    .where(eq(photoCache.wikidataId, wikidataId))
    .limit(1);
  if (cached && Date.now() - cached.fetchedAt.getTime() < TTL_MS) {
    return cached.url;
  }

  let url: string | null = null;
  try {
    const data = await fetchJson<{
      claims?: { P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> };
    }>(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(wikidataId)}&property=P18&format=json`,
      {
        providerId: "wikidata",
        ttlMs: TTL_MS,
        timeoutMs: 6_000,
        minIntervalMs: 150,
        retries: 2
      }
    );
    const filename = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (filename) {
      url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=320`;
    }
  } catch {
    // A rate limit or timeout is not proof that the entity has no image. Reuse an expired value
    // when there is one, but never turn a transient failure into a 30-day negative cache entry.
    return cached?.url ?? null;
  }

  await db
    .insert(photoCache)
    .values({ wikidataId, url })
    .onConflictDoUpdate({
      target: photoCache.wikidataId,
      set: { url, fetchedAt: new Date() }
    });
  return url;
}
