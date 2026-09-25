import { GOLEMIO_LAYERS, type Bbox, type GeoFeature } from "@mapos/layer-sdk";
import { config } from "../../config.js";
import { fetchJson } from "../../utils/upstream.js";
import { bboxCenter, bboxSpanKm, point, withinBbox, type DataSource } from "./types.js";
const text = (v: unknown) =>
  typeof v === "string"
    ? v
        .replace(/<[^>]*>/g, " ")
        .trim()
        .slice(0, 1500)
    : undefined;
/** Golemio v2 sends addresses as schema.org-like objects; a plain `text()` dropped them all. */
export function golemioAddress(value: unknown): string | undefined {
  if (typeof value === "string") return text(value) || undefined;
  if (!value || typeof value !== "object") return undefined;
  const a = value as Record<string, unknown>;
  const formatted = text(a.address_formatted);
  if (formatted) return formatted;
  const locality = [text(a.postal_code), text(a.address_locality)].filter(Boolean).join(" ");
  const parts = [text(a.street_address), locality].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/** "praha-1" → "Praha 1", "praha-kunratice" → "Praha-Kunratice". Golemio districts are slugs. */
export function golemioDistrict(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (!/^[a-z0-9-]+$/u.test(raw)) return raw;
  const words = raw.split("-").filter(Boolean);
  return words
    .map((word, index) => {
      const cased = /^\d+$/u.test(word) ? word : word[0]!.toUpperCase() + word.slice(1);
      if (index === 0) return cased;
      return (/^\d+$/u.test(word) ? " " : "-") + cased;
    })
    .join("");
}

const DAYS: Record<string, string> = {
  monday: "Po",
  tuesday: "Út",
  wednesday: "St",
  thursday: "Čt",
  friday: "Pá",
  saturday: "So",
  sunday: "Ne",
  publicholidays: "Svátky"
};

/** Opening hours arrive as `[{day_of_week, opens, closes}]`; shown as one readable line. */
export function golemioOpeningHours(value: unknown): string | undefined {
  if (typeof value === "string") return text(value) || undefined;
  if (!Array.isArray(value)) return undefined;
  const parts = value.slice(0, 14).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const day = typeof r.day_of_week === "string" ? r.day_of_week.toLowerCase() : "";
    const opens = text(r.opens);
    const closes = text(r.closes);
    if (!opens || !closes) return [];
    return [`${DAYS[day] ?? text(r.day_of_week) ?? ""} ${opens}–${closes}`.trim()];
  });
  return parts.length ? parts.join("; ") : undefined;
}

export function golemioFeatures(data: unknown, layerId: string, bbox: Bbox): GeoFeature[] {
  const rows = (data as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const f = row as {
      geometry?: { type?: string; coordinates?: number[] };
      properties?: Record<string, unknown>;
    };
    const p = f.properties;
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (
      !p ||
      f.geometry?.type !== "Point" ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      Math.abs(lng!) > 180 ||
      Math.abs(lat!) > 90 ||
      !withinBbox(bbox, lng!, lat!) ||
      p.id == null
    )
      return [];
    return [
      point(
        `${layerId}:${String(p.id)}`,
        text(p.name) ?? golemioAddress(p.address) ?? "Místo Golemio",
        lng!,
        lat!,
        layerId,
        {
          category: layerId,
          address: golemioAddress(p.address),
          district: golemioDistrict(p.district),
          description: text(p.description ?? p.perex ?? p.note),
          updatedAt: text(p.updated_at),
          website: text(p.web ?? p.url),
          openingHours: golemioOpeningHours(p.opening_hours ?? p.operating_hours),
          source: "Golemio / Operátor ICT a poskytovatel datasetu",
          sourceUrl: "https://api.golemio.cz/docs/openapi/",
          // Station locations are not a fabricated current pollution / traffic measurement.
          dataScope: "Poloha a publikované údaje zařízení; aktuální měření ověřte u zdroje."
        }
      )
    ];
  });
}
export const golemioSources: DataSource[] = GOLEMIO_LAYERS.map(([id, endpoint]) => ({
  id,
  tooLarge: (bbox) =>
    bboxSpanKm(bbox) > 80 ? "Přibližte mapu na Prahu nebo okolí (do 80 km)." : null,
  async load(bbox, _query, signal) {
    if (bbox[2] < 14 || bbox[0] > 15 || bbox[3] < 49.7 || bbox[1] > 50.4) return [];
    const key = config.layerKeys.golemio;
    if (!key) throw new Error("Golemio není nakonfigurované");
    const center = bboxCenter(bbox);
    const params = new URLSearchParams({
      latlng: `${center.lat},${center.lng}`,
      range: String(Math.ceil(bboxSpanKm(bbox) * 1000)),
      limit: "500"
    });
    const data = await fetchJson<{ features?: unknown[] }>(
      `https://api.golemio.cz/v2/${endpoint}?${params}`,
      {
        providerId: "golemio",
        headers: { "X-Access-Token": key },
        signal,
        ttlMs: 300000,
        timeoutMs: 10000,
        maxResponseBytes: 4 * 1024 * 1024,
        minIntervalMs: 450,
        retries: 0
      }
    );
    return {
      features: golemioFeatures(data, id, bbox),
      status: (data.features?.length ?? 0) >= 500 ? "partial" : "complete",
      notice:
        (data.features?.length ?? 0) >= 500
          ? "Zobrazeno nejvýše 500 záznamů; přibližte mapu."
          : undefined
    };
  }
}));
