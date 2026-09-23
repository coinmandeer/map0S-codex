import type { AreaSelection } from "@mapos/layer-sdk";
import { fetchJson } from "../../utils/upstream.js";
/** Only official identifier joins. No title search, reverse geocoding or nearest-town fallback. */
export function areaIdentifier(area: Pick<AreaSelection, "source" | "country" | "level" | "code">) {
  if (area.level === "lau" && area.source === `gisco-lau-${area.country.toLowerCase()}`) {
    if (area.country === "CZ" && /^CZ_\d{6}$/.test(area.code))
      return { property: "P7606", value: area.code.slice(3), country: "CZ" };
    if (area.country === "ES" && /^ES_\d{5}$/.test(area.code))
      return { property: "P772", value: area.code.slice(3), country: "ES" };
  }
  return null;
}
export async function areaWikidataId(
  area: AreaSelection,
  signal: AbortSignal
): Promise<string | undefined> {
  const identifier = areaIdentifier(area);
  if (!identifier) return;
  const query = `SELECT DISTINCT ?item WHERE { ?item <http://www.wikidata.org/prop/direct/${identifier.property}> "${identifier.value}"; <http://www.wikidata.org/prop/direct/P17> ?country. ?country <http://www.wikidata.org/prop/direct/P297> "${identifier.country}". } LIMIT 2`;
  const url = new URL("https://query.wikidata.org/sparql");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  const result = await fetchJson<{ results?: { bindings?: Array<{ item?: { value?: string } }> } }>(
    url.toString(),
    {
      providerId: "wikidata",
      signal,
      timeoutMs: 2500,
      retries: 0,
      ttlMs: 86400000,
      maxResponseBytes: 32768
    }
  );
  const bindings = result.results?.bindings ?? [];
  if (bindings.length !== 1) return;
  return bindings[0]?.item?.value?.match(/^https?:\/\/www.wikidata.org\/entity\/(Q\d+)$/)?.[1];
}
