import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { Bbox, FeatureCollection } from "@mapos/layer-sdk";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { park4nightCells, park4nightPlaces } from "../db/schema.js";
import { cellBounds, cellId, cellsForBbox, type Cell } from "../utils/tileGrid.js";

const P4N_ENDPOINT = "https://guest.park4night.com/services/V4.1/lieuxGetFilter.php";
const CELL_TTL_MS = 7 * 24 * 3600_000;
const CELL_ZOOM = 8;
const MAX_CELLS = 6;

let lastRequestAt = 0;

/** Park4Night's public API is unofficial and has no documented rate limits — be a polite
 * neighbour and never issue more than one request per second. */
async function rateLimitedFetch(url: string): Promise<Response | null> {
  const wait = Math.max(0, lastRequestAt + 1000 - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  try {
    return await fetch(url, {
      headers: { "User-Agent": config.userAgent },
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return null;
  }
}

function codeToCategory(code: string | undefined): string {
  switch (code) {
    case "C":
      return "p4n-camping";
    case "P":
      return "p4n-parking";
    case "A":
      return "p4n-aire";
    default:
      return "p4n-other";
  }
}

interface P4nPlace {
  id: string;
  latitude: string;
  longitude: string;
  titre?: string;
  name?: string;
  code?: string;
  note_moyenne?: string;
  nb_commentaires?: string;
  point_eau?: string;
  electricite?: string;
  wifi?: string;
  douche?: string;
  wc_public?: string;
  photos?: Array<{ link_thumb?: string }>;
}

async function fetchAroundPoint(lat: number, lng: number): Promise<P4nPlace[]> {
  const res = await rateLimitedFetch(`${P4N_ENDPOINT}?latitude=${lat}&longitude=${lng}`);
  if (!res?.ok) return [];
  try {
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as P4nPlace[]) : [];
  } catch {
    return [];
  }
}

async function ensureCellFetched(cell: Cell) {
  const cId = cellId(cell);
  const [existing] = await db
    .select()
    .from(park4nightCells)
    .where(eq(park4nightCells.cellId, cId))
    .limit(1);
  if (existing && Date.now() - existing.fetchedAt.getTime() < CELL_TTL_MS) return;

  const [w, s, e, n] = cellBounds(cell);
  const places = await fetchAroundPoint((s + n) / 2, (w + e) / 2);

  const rows = places
    .map((p) => ({ p, lat: Number(p.latitude), lng: Number(p.longitude) }))
    .filter(
      ({ lat, lng }) =>
        Number.isFinite(lat) && Number.isFinite(lng) && lat >= s && lat <= n && lng >= w && lng <= e
    )
    .map(({ p, lat, lng }) => {
      const services: string[] = [];
      if (p.point_eau === "1") services.push("water");
      if (p.electricite === "1") services.push("electricity");
      if (p.wifi === "1") services.push("wifi");
      if (p.douche === "1") services.push("shower");
      if (p.wc_public === "1") services.push("toilets");
      return {
        id: `p4n-${p.id}`,
        name: p.name || p.titre || null,
        code: codeToCategory(p.code),
        lng,
        lat,
        rating: p.note_moyenne ? Number(p.note_moyenne) : null,
        reviews: p.nb_commentaires ? Number(p.nb_commentaires) : 0,
        services,
        photoThumb: p.photos?.[0]?.link_thumb ?? null,
        cellId: cId
      };
    });

  if (rows.length) {
    const ids = rows.map((r) => r.id);
    await db.delete(park4nightPlaces).where(inArray(park4nightPlaces.id, ids));
    await db.insert(park4nightPlaces).values(rows);
  }

  await db.delete(park4nightCells).where(eq(park4nightCells.id, cId));
  await db.insert(park4nightCells).values({ id: cId, cellId: cId });
}

export async function getPark4nightFeatures(bbox: Bbox): Promise<FeatureCollection> {
  const cells = cellsForBbox(bbox, MAX_CELLS, CELL_ZOOM);
  for (const cell of cells) {
    await ensureCellFetched(cell).catch((err) =>
      console.warn("Park4Night cell fetch failed:", err)
    );
  }

  const [w, s, e, n] = bbox;
  const rows = await db
    .select()
    .from(park4nightPlaces)
    .where(
      and(
        gte(park4nightPlaces.lng, w),
        lte(park4nightPlaces.lng, e),
        gte(park4nightPlaces.lat, s),
        lte(park4nightPlaces.lat, n)
      )
    )
    .limit(1000);

  return {
    type: "FeatureCollection",
    features: rows.map((r) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] as [number, number] },
      properties: {
        id: r.id,
        name: r.name ?? "Park4Night místo",
        category: r.code ?? "p4n-other",
        layerId: "park4night",
        rating: r.rating ?? undefined,
        reviews: r.reviews ?? 0,
        services: r.services ?? [],
        photo: r.photoThumb ?? undefined,
        externalUrl: `https://park4night.com/en/place/${r.id.replace("p4n-", "")}`
      }
    }))
  };
}
