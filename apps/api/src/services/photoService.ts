import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { photoCache } from "../db/schema.js";

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
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(wikidataId)}&property=P18&format=json`,
      { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.timeout(6000) }
    );
    if (res.ok) {
      const data = (await res.json()) as {
        claims?: { P18?: Array<{ mainsnak?: { datavalue?: { value?: string } } }> };
      };
      const filename = data.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (filename) {
        url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=320`;
      }
    }
  } catch {
    // network/timeout failure — cache the miss below so it's not retried on every card render
  }

  await db.delete(photoCache).where(eq(photoCache.wikidataId, wikidataId));
  await db.insert(photoCache).values({ wikidataId, url });
  return url;
}
