import { config } from "../config.js";

export async function reverseGeocodeCountry(lng: number, lat: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=3&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": config.userAgent },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: { country_code?: string } };
    const code = data.address?.country_code?.toUpperCase();
    return code && code.length === 2 ? code : null;
  } catch {
    return null;
  }
}

export async function loadWikipediaPois(bounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}) {
  const { west, south, east, north } = bounds;
  const centerLat = (south + north) / 2;
  const centerLng = (west + east) / 2;
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${centerLat}|${centerLng}&gsradius=25000&gslimit=20&format=json&origin=*`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: {
        geosearch?: Array<{
          pageid: number;
          title: string;
          lat: number;
          lon: number;
          dist: number;
        }>;
      };
    };
    return (data.query?.geosearch ?? [])
      .filter((p) => p.lon >= west && p.lon <= east && p.lat >= south && p.lat <= north)
      .map((p) => ({
        pageId: p.pageid,
        title: p.title,
        lng: p.lon,
        lat: p.lat,
        distanceM: p.dist
      }));
  } catch {
    return [];
  }
}
